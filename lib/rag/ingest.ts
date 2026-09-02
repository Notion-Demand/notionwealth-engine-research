/**
 * Ensures a transcript's chunks+embeddings exist in transcript_chunks
 * before retrieval needs them. Idempotent and cheap to call on every
 * verification run: checks transcriptChunkRepo.hasChunks() first and does
 * nothing if a previous run (or a future scheduled job — not built yet,
 * see RAG_ARCHITECTURE.md) already ingested this (ticker, quarter).
 *
 * Reuses lib/pipeline.ts's resolvePdfKey() and extractPdfText() rather than
 * re-implementing PDF lookup/parsing — the exact same transcript text the
 * analysis pipelines themselves read.
 */
import { resolvePdfKey, extractPdfText } from "@/lib/pipeline";
import { transcriptChunkRepo } from "@/lib/repositories";
import { chunkTranscriptText } from "@/lib/rag/chunk";
import { embedDocumentsBatch } from "@/lib/rag/embeddings";

export interface IngestOutcome {
  alreadyIngested: boolean;
  chunkCount: number;
}

export async function ensureTranscriptIngested(ticker: string, quarter: string): Promise<IngestOutcome> {
  const already = await transcriptChunkRepo.hasChunks(ticker, quarter);
  if (already) {
    return { alreadyIngested: true, chunkCount: 0 };
  }

  const storageKey = await resolvePdfKey(ticker, quarter);
  const text = await extractPdfText(storageKey);
  const chunks = chunkTranscriptText(text);
  if (chunks.length === 0) {
    return { alreadyIngested: false, chunkCount: 0 };
  }

  const embeddings = await embedDocumentsBatch(chunks.map((c) => c.content));
  await transcriptChunkRepo.insertChunks(
    ticker,
    quarter,
    storageKey,
    chunks.map((c, i) => ({ chunkIndex: c.index, content: c.content, embedding: embeddings[i] }))
  );

  return { alreadyIngested: false, chunkCount: chunks.length };
}
