/**
 * Pure text chunking — no I/O, independently testable.
 *
 * Splits already-extracted transcript text (lib/pipeline.ts's
 * extractPdfText output) into overlapping windows sized for Gemini's
 * text-embedding-004 model. Paragraph-aware where possible: prefers to
 * break on a blank line near the target size rather than mid-sentence, but
 * falls back to a hard character cut for a single paragraph longer than
 * maxChars (concall Q&A can run long without a blank line).
 */
export interface Chunk {
  index: number;
  content: string;
}

const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_OVERLAP_CHARS = 200;

export function chunkTranscriptText(
  text: string,
  opts: { maxChars?: number; overlapChars?: number } = {}
): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    if (end < normalized.length) {
      // Prefer breaking at the last paragraph boundary inside the window;
      // fall back to the last whitespace; fall back to a hard cut.
      const windowText = normalized.slice(start, end);
      const lastParagraph = windowText.lastIndexOf("\n\n");
      const lastWhitespace = windowText.lastIndexOf(" ");
      if (lastParagraph > maxChars * 0.5) {
        end = start + lastParagraph;
      } else if (lastWhitespace > maxChars * 0.5) {
        end = start + lastWhitespace;
      }
    }

    const content = normalized.slice(start, end).trim();
    if (content.length > 0) {
      chunks.push({ index, content });
      index += 1;
    }

    if (end >= normalized.length) break;
    start = Math.max(end - overlapChars, start + 1); // always make forward progress
  }

  return chunks;
}
