/**
 * Thin wrapper around Gemini's text-embedding-004 model (768 dimensions —
 * must match the VECTOR(768) column in supabase/migrations/012_rag.sql).
 *
 * Deliberately asymmetric, per Google's own documented usage: a document
 * being indexed and a query searching against it are embedded with
 * different task types (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY), which
 * measurably improves retrieval quality over embedding both the same way.
 * Getting this wrong (e.g. embedding everything as one generic type) is a
 * common, easy-to-miss RAG correctness bug — called out here explicitly so
 * it isn't repeated when a second retrieval use case is added later.
 */
import { TaskType } from "@google/generative-ai";
import { getGenAI } from "@/lib/llm/genai";

const EMBEDDING_MODEL = "text-embedding-004";
export const EMBEDDING_DIMENSIONS = 768;

export async function embedDocument(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { role: "user", parts: [{ text }] },
    taskType: TaskType.RETRIEVAL_DOCUMENT,
  });
  return result.embedding.values;
}

export async function embedQuery(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { role: "user", parts: [{ text }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  });
  return result.embedding.values;
}

/** Batched document embedding for ingestion — one API call instead of N. */
export async function embedDocumentsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { role: "user", parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    })),
  });
  return result.embeddings.map((e) => e.values);
}
