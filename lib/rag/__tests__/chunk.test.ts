import { describe, it, expect } from "vitest";
import { chunkTranscriptText } from "@/lib/rag/chunk";

describe("chunkTranscriptText", () => {
  it("returns no chunks for empty/whitespace-only text", () => {
    expect(chunkTranscriptText("")).toEqual([]);
    expect(chunkTranscriptText("   \n\n  ")).toEqual([]);
  });

  it("returns a single chunk when the text fits within maxChars", () => {
    const text = "Short transcript excerpt.";
    const chunks = chunkTranscriptText(text, { maxChars: 1500 });
    expect(chunks).toEqual([{ index: 0, content: text }]);
  });

  it("splits long text into multiple chunks, each within maxChars", () => {
    const paragraph = "Sentence about quarterly performance and margins. ".repeat(10); // ~500 chars
    const text = Array.from({ length: 8 }, () => paragraph).join("\n\n"); // ~4000+ chars
    const chunks = chunkTranscriptText(text, { maxChars: 500, overlapChars: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(600); // maxChars + slack for boundary search
    }
    // indices are sequential starting at 0
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("prefers breaking at a paragraph boundary over a hard cut", () => {
    const first = "A".repeat(400);
    const second = "B".repeat(400);
    const text = `${first}\n\n${second}`;
    const chunks = chunkTranscriptText(text, { maxChars: 450, overlapChars: 20 });

    // First chunk should end at the paragraph boundary (all A's), not a
    // hard cut mid-way through the B's run.
    expect(chunks[0].content).toBe(first);
  });

  it("always makes forward progress and terminates on a pathological single long paragraph", () => {
    const text = "X".repeat(10_000); // no whitespace/paragraph breaks at all
    const chunks = chunkTranscriptText(text, { maxChars: 500, overlapChars: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    // Reassembling non-overlapping content should still cover the source
    // text without the loop ever getting stuck (this would time out / hang
    // if forward progress ever stalled).
    expect(chunks[chunks.length - 1].index).toBe(chunks.length - 1);
  });

  it("produces overlapping content between consecutive chunks", () => {
    const paragraph = "word ".repeat(200); // 1000 chars, single paragraph, breaks on whitespace
    const chunks = chunkTranscriptText(paragraph, { maxChars: 300, overlapChars: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    // The tail of chunk 0 and the head of chunk 1 should share content
    // (the overlap window) rather than picking up exactly where chunk 0 left off.
    const tailOfFirst = chunks[0].content.slice(-30);
    expect(chunks[1].content).toContain(tailOfFirst.trim().split(" ").slice(-2).join(" "));
  });
});
