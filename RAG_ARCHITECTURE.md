# RAG Architecture (v0 — one retrieval path, traced end to end)

**Status: first vertical slice.** This describes exactly what's
implemented today — a minimal retrieval pipeline over one transcript at a
time, used by exactly one consumer (the Evidence Verification Agent, see
`AGENT_ARCHITECTURE.md`). It is not a general knowledge base, not a
multi-document corpus, and not a roadmap.

The governing constraint for this slice, stated up front because it drove
every choice below: **the vector store must be just enough to support the
one real use case, not enterprise-scale infrastructure.** That's why this
uses pgvector on the Postgres database Quantalyze already runs, not a new
vector DB service.

---

## What this is

```
lib/agents/evidenceVerification.ts (a claim to check)
        │
        ▼
lib/rag/ingest.ts   ensureTranscriptIngested(ticker, quarter)
        │  (no-op if already chunked+embedded)
        ▼
lib/pipeline.ts     resolvePdfKey() + extractPdfText()   ── same functions
        │                                                    the analysis
        ▼                                                    pipelines use
lib/rag/chunk.ts     chunkTranscriptText()   ── pure, no I/O
        │
        ▼
lib/rag/embeddings.ts   embedDocumentsBatch()   ── text-embedding-004,
        │                                          RETRIEVAL_DOCUMENT
        ▼
lib/repositories/transcriptChunks.ts   insertChunks()
        │
        ▼
Postgres: transcript_chunks (ticker, quarter, chunk_index, content, embedding VECTOR(768))

────────────────────────── retrieval, later, per claim ──────────────────────────

lib/rag/retrieve.ts   retrieveSupportingPassages(ticker, quarter, claim)
        │
        ▼
lib/rag/embeddings.ts   embedQuery()   ── same model, RETRIEVAL_QUERY
        │                                 (asymmetric task type — see below)
        ▼
lib/repositories/transcriptChunks.ts   searchSimilar()
        │
        ▼
Postgres: ORDER BY embedding <=> $query LIMIT topK   (pgvector cosine distance)
```

Retrieval is not decoration here — the passages `retrieveSupportingPassages`
returns are what the agent's Gemini call is grounded on; nothing is ever
labeled RAG in this codebase unless retrieval output actually participates
in generation (project-wide rule).

---

## What's implemented

| Component | File | What it does |
|---|---|---|
| Vector store | `supabase/migrations/012_rag_and_agents.sql` | `pgvector` extension + `transcript_chunks` table (one row per chunk, `VECTOR(768)` column) + `ivfflat` cosine index. No new service — same Azure Postgres instance every other table lives in. |
| Chunking | `lib/rag/chunk.ts` | `chunkTranscriptText()` — pure function, paragraph-aware sliding window (1500 chars, 200 overlap by default), no I/O, independently testable |
| Embeddings | `lib/rag/embeddings.ts` | `embedDocument`/`embedQuery`/`embedDocumentsBatch` — Gemini `text-embedding-004`, 768 dims, **asymmetric task types** (`RETRIEVAL_DOCUMENT` for indexing, `RETRIEVAL_QUERY` for search — see below) |
| Shared Gemini client | `lib/llm/genai.ts` | One client factory for new code (RAG + agents). Does **not** retrofit the 5 existing pipeline files that each instantiate their own — a separate, pre-existing tech-debt item, out of scope here (see "What's explicitly NOT implemented") |
| Ingestion | `lib/rag/ingest.ts` | `ensureTranscriptIngested(ticker, quarter)` — idempotent (checks `hasChunks` first), reuses `lib/pipeline.ts`'s `resolvePdfKey`/`extractPdfText` rather than re-parsing PDFs a second way |
| Retrieval | `lib/rag/retrieve.ts` | `retrieveSupportingPassages(ticker, quarter, claim, topK=4)` — embed the claim, cosine-search `transcript_chunks` scoped to that exact (ticker, quarter) |
| Persistence layer | `lib/repositories/transcriptChunks.ts` | `hasChunks`, `insertChunks`, `searchSimilar` — pgvector's wire format handled with a plain text `::vector` cast, no `pgvector` npm dependency added for one column type |
| Tests | `lib/rag/__tests__/chunk.test.ts` | Chunking correctness: empty input, single-chunk, multi-chunk, paragraph-boundary preference, forward-progress/termination on pathological input, overlap |

### Why pgvector, not a new vector DB

Quantalyze already runs Azure Database for PostgreSQL. Adding Pinecone,
Weaviate, or a self-hosted vector service would mean a second data store to
provision, secure, back up, and keep consistent with the primary database
— for a corpus that is, today, one transcript's worth of chunks per
verification run. pgvector gets genuine ANN search (`ivfflat`, cosine
distance) inside the existing transactional database, with the existing
connection pool, existing backup story, and existing access control. This
is the "just enough, not enterprise-scale" call made explicit.

### The one real infra prerequisite

Azure Database for PostgreSQL Flexible Server does not allow arbitrary
`CREATE EXTENSION` calls — `vector` must first be added to the server's
`azure.extensions` allowlist parameter, or migration `012` fails outright
(`scripts/migrate-schema-to-azure.ts` halts on the first failing
statement, by design). This is documented as a real one-time operational
step directly in the migration file, not assumed or silently worked
around:

```bash
az postgres flexible-server parameter set \
  --resource-group quantalyze-prod-rg --server-name <server> \
  --name azure.extensions --value VECTOR
```

(Append to whatever's already allowlisted — check the current value first.)

### Asymmetric embeddings

A document being indexed and a query searching against it are embedded
with **different task types** — `RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY` —
per Google's own guidance for `text-embedding-004`. Embedding both the same
way is a common, easy-to-miss RAG correctness bug (queries and documents
have different length/structure statistics; the asymmetric training
measurably improves retrieval quality). `lib/rag/embeddings.ts` keeps this
explicit rather than exposing one generic `embed()` function a caller could
misuse.

### Scope: single-transcript, not a corpus

`transcript_chunks` is scoped by `(ticker, quarter)` and retrieval is
always scoped to one specific transcript (`searchSimilar` takes `ticker`
and `quarter`, not just a query vector). This is deliberately narrower than
"a knowledge base over all transcripts" — there is no cross-document or
cross-company retrieval in this slice. Building that (a real corpus-wide
index, re-ranking, hybrid keyword+vector search) is future work, not
implied by what exists today.

---

## How to trace this end to end

1. `lib/agents/evidenceVerification.ts` calls `ensureTranscriptIngested`
   before it needs retrieval for a given (ticker, quarter).
2. `lib/rag/ingest.ts` checks `transcriptChunkRepo.hasChunks` — if chunks
   already exist, this is a no-op (idempotent, safe to call on every run).
3. Otherwise: `resolvePdfKey`/`extractPdfText` (both from
   `lib/pipeline.ts`, unchanged) get the transcript text, `chunkTranscriptText`
   splits it, `embedDocumentsBatch` embeds every chunk in one API call, and
   `transcriptChunkRepo.insertChunks` writes them (`ON CONFLICT DO NOTHING`,
   idempotent per-chunk too).
4. Per claim, `lib/rag/retrieve.ts`'s `retrieveSupportingPassages` embeds
   the claim text (`embedQuery`) and calls `transcriptChunkRepo.searchSimilar`,
   which runs `ORDER BY embedding <=> $query LIMIT topK` scoped to that
   transcript.
5. The returned `SimilarChunk[]` (content + cosine distance) is what
   `lib/agents/evidenceVerification.ts` passes into its Gemini verification
   call — see `AGENT_ARCHITECTURE.md`.

---

## What's explicitly NOT implemented (don't claim this exists)

- **No knowledge graph / KAG.** Retrieval here is pure vector similarity
  over transcript chunks — no entities, no relationships, no graph
  traversal. The user's own staged plan (RAG → graph → hybrid retrieval)
  explicitly deferred the graph step; this slice is RAG only, by request.
- **No hybrid (keyword + vector) search, no re-ranking.** `searchSimilar`
  is a single `ORDER BY <=>` query. No BM25/full-text fallback, no
  cross-encoder re-ranking pass.
- **No cross-transcript or cross-company retrieval.** Every search is
  scoped to exactly one `(ticker, quarter)`. There is no "search across
  everything Quantalyze has ever ingested" capability.
- **No background/scheduled ingestion.** Chunks are only ever created
  lazily, the first time a verification run needs them. There's no cron
  job pre-ingesting every transcript as it's uploaded.
- **No chunk/embedding versioning.** If `chunkTranscriptText`'s window
  size or the embedding model ever changes, existing rows in
  `transcript_chunks` become stale silently — there's no schema field
  recording which chunking/embedding version produced a row, and no
  re-ingestion trigger. A real second iteration would need this before
  changing either.
- **The five existing analysis pipelines were not retrofitted onto
  `lib/llm/genai.ts`.** They still each instantiate their own
  `GoogleGenerativeAI` client. Consolidating them is a separate,
  pre-existing tech-debt item (see `discussions/`), not something this
  slice does as a side effect.
