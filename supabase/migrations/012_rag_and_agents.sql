-- Minimal knowledge substrate for RAG-backed quote/claim verification, plus
-- persistence for the evidence-verification agent's output.
--
-- OPERATIONAL PREREQUISITE — read before running this migration:
-- Azure Database for PostgreSQL Flexible Server does not enable arbitrary
-- extensions by default. `CREATE EXTENSION vector` will FAIL until the
-- server's `azure.extensions` allowlist parameter includes VECTOR:
--   az postgres flexible-server parameter set \
--     --resource-group quantalyze-prod-rg --server-name <server> \
--     --name azure.extensions --value VECTOR
-- (append to whatever's already allowlisted rather than overwriting it —
-- check the current value first). This is a real, one-time infra step, not
-- optional boilerplate — scripts/migrate-schema-to-azure.ts throws and
-- halts on the first failing statement, so this must be done before this
-- file (012) can be applied at all.
--
-- No RLS on either table — same rationale as user_credits/api_access:
-- accessed only via the application's own repository layer.

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per transcript chunk. Scoped to (ticker, quarter) rather than a
-- cross-company corpus — retrieval for quote verification only ever needs
-- passages from the SAME transcript a claim came from, so there's no
-- product reason yet to build cross-document retrieval. Revisit if a
-- second retrieval use case needs it (see RAG_ARCHITECTURE.md).
CREATE TABLE IF NOT EXISTS transcript_chunks (
  id           BIGSERIAL   PRIMARY KEY,
  ticker       TEXT        NOT NULL,
  quarter      TEXT        NOT NULL,
  storage_key  TEXT        NOT NULL,
  chunk_index  INTEGER     NOT NULL,
  content      TEXT        NOT NULL,
  -- 768 dims — must match EMBEDDING_DIMENSIONS in lib/rag/embeddings.ts
  -- (Gemini text-embedding-004). Changing embedding models means a new
  -- column/table, not an in-place ALTER, since dimensions differ by model.
  embedding    VECTOR(768) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, quarter, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_transcript_chunks_ticker_quarter
  ON transcript_chunks (ticker, quarter);

-- ivfflat needs data + ANALYZE to build a useful index; harmless to create
-- now against an empty table (Postgres just builds it with lists=100 and
-- it improves as rows are added). Revisit `lists` once real row counts
-- exist — the pgvector docs' own rule of thumb is roughly sqrt(row count).
CREATE INDEX IF NOT EXISTS idx_transcript_chunks_embedding
  ON transcript_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- One row per evidence-verification agent run. Deliberately NOT upserted —
-- each run is kept as its own record (an audit trail of what the agent
-- concluded and when), the same "append, don't overwrite" choice
-- analysis_results makes for analysis runs.
CREATE TABLE IF NOT EXISTS evidence_verifications (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker                    TEXT        NOT NULL,
  quarter                   TEXT        NOT NULL,
  quarter_previous          TEXT        NOT NULL,
  status                    TEXT        NOT NULL, -- 'completed' | 'partial' | 'failed'
  findings                  JSONB       NOT NULL, -- EvidenceFinding[] — see lib/agents/evidenceVerification.ts
  supported_count           INTEGER     NOT NULL,
  unsupported_count         INTEGER     NOT NULL,
  uncertain_count           INTEGER     NOT NULL,
  model                     TEXT        NOT NULL,
  agent_version             TEXT        NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_verifications_lookup
  ON evidence_verifications (ticker, quarter, quarter_previous, created_at DESC);
