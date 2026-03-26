import { NextRequest, NextResponse } from "next/server";
import { NIFTY200 } from "@/lib/nifty200";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runPipeline, resolvePdfKey } from "@/lib/pipeline";
import { getCachedAnalysis, saveAnalysis } from "@/lib/analysis-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET = "transcripts";

/**
 * POST /api/v1/seed-analysis
 *
 * Runs the analysis pipeline for all Nifty 200 companies that have both
 * Q2_2026 and Q3_2026 transcripts in the bucket. Skips companies that
 * already have cached analysis results.
 *
 * Streams progress as NDJSON.
 *
 * Query params:
 *   ?q_prev=Q2_2026        — previous quarter (default: Q2_2026)
 *   ?q_curr=Q3_2026        — current quarter (default: Q3_2026)
 *   ?tickers=TCS,INFY      — limit to specific tickers (comma-separated)
 *   ?force=1               — re-run even if cached analysis exists
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const qPrev = url.searchParams.get("q_prev") ?? "Q2_2026";
  const qCurr = url.searchParams.get("q_curr") ?? "Q3_2026";
  const force = url.searchParams.has("force");
  const tickerFilter = url.searchParams.get("tickers")?.toUpperCase().split(",").filter(Boolean) ?? null;

  const tickers = tickerFilter
    ? tickerFilter.filter((t) => NIFTY200[t])
    : Object.keys(NIFTY200);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      // 1. List all existing files to know which tickers have both quarters
      const existingNames = new Set<string>();
      let offset = 0;
      while (true) {
        const { data: page } = await supabaseAdmin()
          .storage.from(BUCKET)
          .list("", { limit: 100, offset });
        if (!page || page.length === 0) break;
        for (const f of page) existingNames.add(f.name.toLowerCase());
        offset += page.length;
      }

      // 2. Filter to tickers that have BOTH quarter PDFs
      const eligible: string[] = [];
      const missingTranscripts: string[] = [];

      for (const ticker of tickers) {
        const prevFile = `${ticker}_${qPrev}.pdf`.toLowerCase();
        const currFile = `${ticker}_${qCurr}.pdf`.toLowerCase();
        if (existingNames.has(prevFile) && existingNames.has(currFile)) {
          eligible.push(ticker);
        } else {
          missingTranscripts.push(ticker);
        }
      }

      send({
        type: "init",
        totalTickers: tickers.length,
        eligible: eligible.length,
        missingTranscripts: missingTranscripts.length,
        qPrev,
        qCurr,
        force,
      });

      let analyzed = 0;
      let cached = 0;
      let failed = 0;

      // 3. Run analysis for each eligible ticker
      for (let idx = 0; idx < eligible.length; idx++) {
        const ticker = eligible[idx];
        const info = NIFTY200[ticker];

        try {
          // Check cache first (unless force)
          if (!force) {
            const existing = await getCachedAnalysis(ticker, qPrev, qCurr);
            if (existing) {
              cached++;
              send({
                type: "ticker",
                idx: idx + 1,
                ticker,
                name: info.name,
                status: "cached",
                overall_signal: existing.overall_signal,
                overall_score: existing.overall_score,
              });
              continue;
            }
          }

          // Resolve PDF keys
          const qPrevKey = await resolvePdfKey(ticker, qPrev);
          const qCurrKey = await resolvePdfKey(ticker, qCurr);

          send({
            type: "ticker",
            idx: idx + 1,
            ticker,
            name: info.name,
            status: "running",
          });

          // Run the pipeline
          const payload = await runPipeline(qPrevKey, qCurrKey);

          // Save to DB
          await saveAnalysis(null, ticker, qPrev, qCurr, payload);
          analyzed++;

          send({
            type: "ticker",
            idx: idx + 1,
            ticker,
            name: info.name,
            status: "done",
            overall_signal: payload.overall_signal,
            overall_score: payload.overall_score,
          });
        } catch (e) {
          failed++;
          send({
            type: "ticker",
            idx: idx + 1,
            ticker,
            name: info.name,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      send({
        type: "done",
        analyzed,
        cached,
        failed,
        missingTranscripts: missingTranscripts.length,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
