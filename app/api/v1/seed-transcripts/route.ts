import { NextRequest, NextResponse } from "next/server";
import { NIFTY200, SCREENER_SLUGS_200 } from "@/lib/nifty200";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
    fetchCompanyPage,
    fetchBseTranscripts,
    downloadPdf,
    inferQuarterFromNseUrl,
    inferQuarterFromText,
    inferQuarterFromHtml,
} from "@/lib/transcript-fetcher";
import pdfParse from "pdf-parse";

export const maxDuration = 300; // Vercel Pro limit — 200 tickers take time

const BUCKET = "transcripts";

/**
 * POST /api/v1/seed-transcripts
 *
 * Downloads the last 2 quarter transcripts for every Nifty 200 company
 * that doesn't already have them in the Supabase `transcripts` bucket.
 *
 * Streams progress back as newline-delimited JSON.
 *
 * Optional query params:
 *   ?tickers=RELIANCE,TCS  — limit to specific tickers (comma-separated)
 *   ?max=2                 — max transcripts per ticker (default: 2)
 *   ?dry=1                 — dry run: report what would be downloaded
 */
export async function POST(req: NextRequest) {
    const url = new URL(req.url);
    const tickerFilter = url.searchParams.get("tickers")?.toUpperCase().split(",").filter(Boolean) ?? null;
    const maxPerTicker = parseInt(url.searchParams.get("max") ?? "2") || 2;
    const dryRun = url.searchParams.has("dry");

    // Build ticker list — filtered or all Nifty 200
    const tickers = tickerFilter
        ? tickerFilter.filter((t) => NIFTY200[t])
        : Object.keys(NIFTY200);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: object) => {
                controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
            };

            // 1. List all existing files in the bucket
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

            send({
                type: "init",
                totalTickers: tickers.length,
                existingFiles: existingNames.size,
                dryRun,
            });

            let totalUploaded = 0;
            let totalSkipped = 0;
            let totalErrors = 0;

            // 2. Process each ticker sequentially (to avoid rate-limiting)
            for (let idx = 0; idx < tickers.length; idx++) {
                const ticker = tickers[idx];
                const info = NIFTY200[ticker];
                const uploaded: string[] = [];
                const skipped: string[] = [];
                const errors: string[] = [];

                try {
                    // Resolve screener.in company page URL
                    const slug = SCREENER_SLUGS_200[ticker];
                    const companyPageUrl = slug ? `https://www.screener.in${slug}` : null;

                    if (!companyPageUrl) {
                        errors.push("no_screener_slug");
                        send({ type: "ticker", idx: idx + 1, ticker, name: info.name, uploaded, skipped, errors });
                        totalErrors++;
                        continue;
                    }

                    // Fetch transcript links
                    const { transcriptLinks: screenerLinks, bseCode } = await fetchCompanyPage(companyPageUrl);
                    const bseApiLinks = bseCode ? await fetchBseTranscripts(bseCode) : [];

                    // Merge (screener first, then unique BSE links)
                    const screenerUrls = new Set(screenerLinks.map((l) => l.url));
                    const allLinks = [
                        ...screenerLinks,
                        ...bseApiLinks.filter((l) => !screenerUrls.has(l.url)),
                    ];

                    if (!allLinks.length) {
                        errors.push("no_transcripts_found");
                        send({ type: "ticker", idx: idx + 1, ticker, name: info.name, uploaded, skipped, errors });
                        totalErrors++;
                        continue;
                    }

                    // Download up to `maxPerTicker` transcripts
                    for (const { url: pdfUrl, htmlContext } of allLinks.slice(0, maxPerTicker)) {
                        const urlFile = pdfUrl.split("/").pop() ?? pdfUrl;
                        try {
                            // Quick pre-check via URL-inferred quarter
                            const quarterFromUrl = inferQuarterFromNseUrl(pdfUrl);
                            if (quarterFromUrl) {
                                const [q, y] = quarterFromUrl;
                                const candidateName = `${ticker}_Q${q}_${y}.pdf`;
                                if (existingNames.has(candidateName.toLowerCase())) {
                                    skipped.push(candidateName);
                                    continue;
                                }
                            }

                            if (dryRun) {
                                uploaded.push(`[dry] ${urlFile}`);
                                continue;
                            }

                            const pdf = await downloadPdf(pdfUrl);

                            // Infer quarter
                            let quarterInfo: [number, number] | null = null;
                            try {
                                const parsed = await pdfParse(pdf, { max: 3 });
                                quarterInfo = inferQuarterFromText(parsed.text);
                            } catch { /* ignore */ }
                            if (!quarterInfo) quarterInfo = inferQuarterFromNseUrl(pdfUrl);
                            if (!quarterInfo) quarterInfo = inferQuarterFromHtml(htmlContext, urlFile);
                            if (!quarterInfo) {
                                errors.push(`no_quarter:${urlFile}`);
                                continue;
                            }

                            const [q, y] = quarterInfo;
                            const filename = `${ticker}_Q${q}_${y}.pdf`;

                            if (existingNames.has(filename.toLowerCase())) {
                                skipped.push(filename);
                                continue;
                            }

                            const { error: uploadError } = await supabaseAdmin()
                                .storage.from(BUCKET)
                                .upload(filename, pdf, { contentType: "application/pdf", upsert: true });

                            if (uploadError) {
                                errors.push(`upload_failed:${filename}:${uploadError.message}`);
                                continue;
                            }

                            existingNames.add(filename.toLowerCase());
                            uploaded.push(filename);
                        } catch (e) {
                            errors.push(`error:${urlFile}:${e instanceof Error ? e.message : String(e)}`);
                        }
                    }

                    totalUploaded += uploaded.length;
                    totalSkipped += skipped.length;
                    totalErrors += errors.length;

                    send({
                        type: "ticker",
                        idx: idx + 1,
                        ticker,
                        name: info.name,
                        uploaded,
                        skipped,
                        errors,
                    });
                } catch (e) {
                    errors.push(`fatal:${e instanceof Error ? e.message : String(e)}`);
                    totalErrors++;
                    send({ type: "ticker", idx: idx + 1, ticker, name: info.name, uploaded, skipped, errors });
                }

                // Small delay to avoid rate-limiting (300ms between tickers)
                await new Promise((r) => setTimeout(r, 300));
            }

            send({
                type: "done",
                totalUploaded,
                totalSkipped,
                totalErrors,
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
