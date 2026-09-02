/**
 * Repository for transcript_chunks (supabase/migrations/012_rag_and_agents.sql)
 * — the minimal knowledge substrate behind RAG-backed quote verification.
 *
 * pgvector's wire format for a VECTOR column, via the plain `pg` driver
 * (no pgvector npm package added — one more dependency wasn't worth it for
 * one column type): a bracketed, comma-separated literal like "[0.1,0.2]",
 * bound as a normal text parameter with an explicit `::vector` cast in the
 * SQL. See toVectorLiteral() below.
 */
import { query } from "@/lib/postgres/client";

export interface ChunkToInsert {
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface SimilarChunk {
  chunkIndex: number;
  content: string;
  /** Cosine distance (0 = identical direction, 2 = opposite) — lower is more similar. */
  distance: number;
}

export interface TranscriptChunkRepository {
  hasChunks(ticker: string, quarter: string): Promise<boolean>;
  insertChunks(ticker: string, quarter: string, storageKey: string, chunks: ChunkToInsert[]): Promise<void>;
  searchSimilar(ticker: string, quarter: string, queryEmbedding: number[], topK: number): Promise<SimilarChunk[]>;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class PostgresTranscriptChunkRepository implements TranscriptChunkRepository {
  async hasChunks(ticker: string, quarter: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM transcript_chunks WHERE ticker = $1 AND quarter = $2) AS exists`,
      [ticker, quarter]
    );
    return rows[0]?.exists ?? false;
  }

  async insertChunks(ticker: string, quarter: string, storageKey: string, chunks: ChunkToInsert[]): Promise<void> {
    if (chunks.length === 0) return;
    // One INSERT per chunk, not a multi-row VALUES list — simpler parameter
    // binding, and ingestion is a background/on-demand operation (not on the
    // hot path of a user request), so per-statement overhead doesn't matter
    // the way it would in a request-serving loop.
    for (const chunk of chunks) {
      await query(
        `INSERT INTO transcript_chunks (ticker, quarter, storage_key, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)
         ON CONFLICT (ticker, quarter, chunk_index) DO NOTHING`,
        [ticker, quarter, storageKey, chunk.chunkIndex, chunk.content, toVectorLiteral(chunk.embedding)]
      );
    }
  }

  async searchSimilar(ticker: string, quarter: string, queryEmbedding: number[], topK: number): Promise<SimilarChunk[]> {
    const rows = await query<{ chunk_index: number; content: string; distance: number }>(
      `SELECT chunk_index, content, embedding <=> $3::vector AS distance
       FROM transcript_chunks
       WHERE ticker = $1 AND quarter = $2
       ORDER BY embedding <=> $3::vector
       LIMIT $4`,
      [ticker, quarter, toVectorLiteral(queryEmbedding), topK]
    );
    return rows.map((r) => ({ chunkIndex: r.chunk_index, content: r.content, distance: r.distance }));
  }
}
