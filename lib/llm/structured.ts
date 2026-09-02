/**
 * Shared "call Gemini, get typed JSON back" helper for new code — the
 * companion to lib/llm/genai.ts's shared client factory.
 *
 * lib/pipeline.ts already has a private, unexported invokeStructured() with
 * this exact shape (schema-constrained generateContent + a timeout race).
 * Rather than either (a) reaching into pipeline.ts's internals, which
 * aren't exported, or (b) pasting a fourth/fifth copy of the same 20 lines,
 * this is the ONE shared copy for everything that isn't one of the five
 * existing pipeline files — same scoping rule as genai.ts: consolidating
 * the five existing pipelines' private copies is a separate, pre-existing
 * tech-debt item, out of scope for this slice.
 */
import type { Schema } from "@google/generative-ai";
import { getGenAI } from "@/lib/llm/genai";

const DEFAULT_TIMEOUT_MS = 25_000;

export async function invokeStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: Schema,
  opts?: { modelName?: string; timeoutMs?: number }
): Promise<T> {
  const modelName = opts?.modelName ?? "gemini-2.5-flash-lite";
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
    } as any,
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Gemini call timed out")), timeoutMs)
  );
  const result = await Promise.race([model.generateContent(userPrompt), timeout]);
  return JSON.parse(result.response.text()) as T;
}
