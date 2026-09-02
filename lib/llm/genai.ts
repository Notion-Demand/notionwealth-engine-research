/**
 * One shared Gemini client factory, for lib/rag/ and lib/agents/ only.
 *
 * Quantalyze's five existing AI pipeline files (lib/pipeline.ts,
 * lib/solo-pipeline.ts, lib/insights-pipeline.ts, lib/kpi-extractor.ts,
 * lib/sector-narrative.ts) each instantiate their own copy of this exact
 * factory — a real, already-documented gap (discussions/16_ONELEET_JD_
 * MAPPING.md's "no shared reusable AI-call helper" finding). This file does
 * NOT retrofit those five files; consolidating them is a separate,
 * pre-existing tech-debt item and out of scope for the RAG/agents slice
 * that introduced this. What it does do is make sure this slice doesn't add
 * a SIXTH copy — new AI-calling code from here on (embeddings, the
 * evidence-verification agent) shares this one.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

let _client: GoogleGenerativeAI | null = null;

export function getGenAI(): GoogleGenerativeAI {
  if (!_client) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
    _client = new GoogleGenerativeAI(apiKey);
  }
  return _client;
}
