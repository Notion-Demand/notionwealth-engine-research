# Agent Architecture (v0 — one autonomous agent, traced end to end)

**Status: first vertical slice.** This describes exactly what's
implemented today — one agent, the Evidence Verification Agent, exposed
through one MCP tool. It is not a multi-agent system, not an
orchestration framework, and not a roadmap.

The rule this slice was built to satisfy (from the project's own
non-negotiables): **never introduce an agent where a deterministic
function would do.** Before writing this, the honest question was asked —
does checking a claim against a transcript actually need an LLM making
judgment calls, or would a keyword match suffice? It needs judgment: a
claim like "margins expanded" can be true in spirit while worded
differently in the transcript, and a false positive/negative here is
exactly the kind of thing that benefits from (grounded, evidence-anchored)
reasoning rather than string matching. That's the bar this agent had to
clear to exist.

---

## What this is

An agent that runs a real **observe → retrieve → verify → synthesize →
persist** loop — not a single LLM call wearing an "agent" label.

```
lib/mcp/tools/verifyCompanyAnalysis.ts   (MCP tool: verify_company_analysis)
        │
        ▼
lib/agents/evidenceVerification.ts   runEvidenceVerificationAgent(ticker)
        │
        ├─ OBSERVE     analysisRepo.getLatestByTickerWithMeta(ticker)
        │               → the pipeline's own earningsDelta claims (capped at 5)
        │
        ├─ RETRIEVE     lib/rag/ingest.ts + lib/rag/retrieve.ts, per claim
        │               → real transcript passages via pgvector search
        │                 (see RAG_ARCHITECTURE.md)
        │
        ├─ VERIFY        lib/llm/structured.ts invokeStructured(), per claim
        │               → one grounded Gemini call: "do these passages
        │                 support/contradict/not-settle this claim?"
        │
        ├─ SYNTHESIZE    aggregate supported/unsupported/uncertain counts,
        │               decide run status (completed/partial/failed)
        │
        └─ PERSIST       evidenceVerificationRepo.save()
                        → a durable, queryable row in evidence_verifications,
                          not a paragraph that evaporates after one response
```

What makes this "autonomous" rather than "a function that calls an LLM
once": it makes its own per-claim decisions (retrieve → is there enough
evidence to even ask? → ask → was the call trustworthy?), and it decides
its own overall outcome status from what actually happened during the run,
rather than always reporting success.

---

## What's implemented

| Component | File | What it does |
|---|---|---|
| The agent | `lib/agents/evidenceVerification.ts` | `runEvidenceVerificationAgent(ticker)` — the full loop, a pure async function independently testable without an MCP server |
| Verification persistence | `lib/repositories/evidenceVerifications.ts`, `supabase/migrations/012_rag_and_agents.sql` | `evidence_verifications` table — Quantalyze's first "intelligence object" table: an agent's conclusion + its evidence + its provenance, kept together, queryable |
| Shared structured-call helper | `lib/llm/structured.ts` | `invokeStructured<T>()` — schema-constrained Gemini call + timeout, the one shared copy for new code (see `RAG_ARCHITECTURE.md` on why the 5 existing pipelines weren't retrofitted) |
| MCP tool | `lib/mcp/tools/verifyCompanyAnalysis.ts`, registered in `lib/mcp/server.ts` | `verify_company_analysis(ticker)` — thin adapter, `readOnlyHint: false` (this tool writes), maps agent outcome codes to structured MCP errors |
| Tests | `lib/agents/__tests__/evidenceVerification.test.ts`, `lib/mcp/tools/__tests__/verifyCompanyAnalysis.test.ts` | Agent loop with every dependency mocked (no real Postgres/Gemini calls): not-found/no-claims/ingestion-failure outcomes, completed/partial/failed status derivation, claim cap, MCP envelope shaping |

### The `AgentResult`-style contract

Every run produces exactly one `EvidenceVerificationResult`:

```ts
{
  ticker, quarter, quarterPrevious,
  status: "completed" | "partial" | "failed",
  findings: EvidenceFinding[],   // { claim, status, supportingPassages, reasoning }
  supportedCount, unsupportedCount, uncertainCount,
  model, agentVersion, createdAt,
}
```

`status` is derived honestly from what actually happened, not defaulted to
`"completed"`:
- **`completed`** — every claim's verification call succeeded (a claim
  legitimately verdicted `"uncertain"` by the model is still success — the
  model doing its job, not a failure).
- **`partial`** — at least one claim's retrieval or Gemini call errored
  (timeout, API failure). That claim is recorded with status `"uncertain"`
  and a reasoning string explaining the call failed, distinct from the
  model choosing `"uncertain"`.
- **`failed`** — every claim's verification call errored.

This distinction (call failure vs. legitimate model uncertainty) is
preserved in each finding's `reasoning` field rather than collapsed into
one number, on purpose — an evidence record that can't tell the difference
between "we couldn't check this" and "we checked and it's genuinely
ambiguous" isn't trustworthy evidence.

### Why this checks the pipeline's OWN output

The agent doesn't invent new claims to verify — it takes `earningsDelta`,
the exact bullet list `lib/pipeline.ts`'s existing synthesis step already
produced, and checks each one against the transcript it was supposedly
derived from. This is deliberately a fact-check of Quantalyze's own
generation step, not a general-purpose "ask anything about a transcript"
tool. That scope keeps the agent's job — and what "supported" vs
"unsupported" means — unambiguous.

### Cost/latency discipline

`MAX_CLAIMS = 5` — one Gemini call per claim, run synchronously inside an
MCP tool invocation. This is a stated, deliberate cap, not an oversight:
widening it (or moving to a background/async job so a caller isn't
blocked on N sequential Gemini calls) is a real design decision for a
later slice, not something to silently change.

---

## How to trace this end to end

1. `lib/mcp/server.ts` registers `verify_company_analysis` — not
   `readOnlyHint`, since it writes a new `evidence_verifications` row on
   every call.
2. `lib/mcp/tools/verifyCompanyAnalysis.ts`'s `runVerifyCompanyAnalysis()`
   calls the agent and maps its outcome (`NOT_FOUND` / `NO_CLAIMS` /
   `INGESTION_FAILED` / success) into the MCP envelope or a structured
   error — same pattern as `getCompanyAnalysis.ts`.
3. `lib/agents/evidenceVerification.ts`'s `runEvidenceVerificationAgent()`
   is the actual loop — read this file top to bottom to see every decision
   the agent makes, in order.
4. Retrieval within the loop is `lib/rag/ingest.ts` +
   `lib/rag/retrieve.ts` — see `RAG_ARCHITECTURE.md`.
5. Verification within the loop is `lib/llm/structured.ts`'s
   `invokeStructured()` with `VERIFICATION_SCHEMA` (defined in
   `evidenceVerification.ts`) — a schema-constrained, temperature-0 Gemini
   call, same discipline as every other structured call in this codebase.
6. `lib/repositories/evidenceVerifications.ts`'s `save()` is the PERSIST
   step — one `INSERT ... RETURNING id`.

Run it locally (after provisioning an `mcp:tools` key, same as
`MCP_ARCHITECTURE.md`):

```bash
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer <raw key>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify_company_analysis","arguments":{"ticker":"RELIANCE"}}}'
```

---

## What's explicitly NOT implemented (don't claim this exists)

- **Only one agent.** No orchestration layer, no multi-agent handoff, no
  agent-calls-agent pattern. The user's own staged plan calls for "one
  autonomous sector workflow" next, after this one is understood — that's
  a separate future slice, not implied by what exists here.
- **No verification-run caching/dedup.** Calling `verify_company_analysis`
  twice for the same ticker runs the full loop twice and writes two rows.
  There's no "don't re-verify if nothing changed" logic.
- **No retry/backoff on a failed Gemini call.** A failed call is recorded
  as `"uncertain"` with an explanatory reasoning string once — it is not
  retried within the same run.
- **Only `earningsDelta` claims are checked**, and only the first 5 of
  those. `sections`, `fcfImplications`, and `keyMetrics` from the same
  `Analysis` are not verified by this agent. Widening claim coverage is
  real future work, not an oversight.
- **No background/scheduled runs.** The agent only runs synchronously,
  inside one MCP tool call, when a caller explicitly invokes it.
- **No per-tool entitlement split.** Same gap `MCP_ARCHITECTURE.md`
  already flags: any key entitled to `mcp:tools` can call
  `verify_company_analysis` and trigger real Gemini spend, same as any
  other registered tool. A tool with a materially different cost profile
  deserves its own quota story eventually.
- **CI does not run `npm test`** — same pre-existing gap noted in
  `MCP_ARCHITECTURE.md`, unchanged by this slice.
