/**
 * The actual retrieval half of RAG: given a claim, find the transcript
 * passages most likely to support or contradict it. This is what makes
 * lib/agents/evidenceVerification.ts genuine RAG rather than a plain LLM
 * call — the retrieved passages here are what get passed into the
 * generation step, not decoration around it (see the project-wide rule:
 * "don't call something RAG unless retrieval actually participates in
 * generation").
 */
import { transcriptChunkRepo } from "@/lib/repositories";
import { embedQuery } from "@/lib/rag/embeddings";
import type { SimilarChunk } from "@/lib/repositories/transcriptChunks";

const DEFAULT_TOP_K = 4;

export async function retrieveSupportingPassages(
  ticker: string,
  quarter: string,
  claim: string,
  topK: number = DEFAULT_TOP_K
): Promise<SimilarChunk[]> {
  const queryEmbedding = await embedQuery(claim);
  return transcriptChunkRepo.searchSimilar(ticker, quarter, queryEmbedding, topK);
}
