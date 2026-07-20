import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "API Docs — Quantalyze",
  description:
    "Quantalyze Public API v1 reference: authentication, endpoints, rate limits, and error handling.",
};

const BASE_URL = "https://quantalyze.me/api/public/v1";
const CALENDLY = "https://calendly.com/quantalyze/say-hi";

function highlightJson(code: string): ReactNode {
  const regex =
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(code.slice(lastIndex, match.index));
    }
    const token = match[0];
    let className = "text-amber-300";
    if (token.startsWith('"')) {
      className = /:\s*$/.test(token) ? "text-sky-400" : "text-emerald-400";
    } else if (token === "true" || token === "false") {
      className = "text-purple-400";
    } else if (token === "null") {
      className = "text-white/30";
    }
    nodes.push(
      <span key={key++} className={className}>
        {token}
      </span>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < code.length) {
    nodes.push(code.slice(lastIndex));
  }
  return nodes;
}

function highlightBash(code: string): ReactNode {
  const regex = /(--?[a-zA-Z-]+|"[^"]*")/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(code.slice(lastIndex, match.index));
    }
    const token = match[0];
    const className = token.startsWith("-") ? "text-sky-400" : "text-emerald-400";
    nodes.push(
      <span key={key++} className={className}>
        {token}
      </span>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < code.length) {
    nodes.push(code.slice(lastIndex));
  }
  return nodes;
}

function CodeBlock({ code, lang }: { code: string; lang: "bash" | "json" }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/5">
      <pre className="px-4 py-3 text-[13px] leading-relaxed">
        <code className="font-mono text-white/80">
          {lang === "json" ? highlightJson(code) : highlightBash(code)}
        </code>
      </pre>
    </div>
  );
}

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Nav */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-white">
          Quantalyze
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-12">
        <h1 className="mb-2 text-3xl font-bold text-white">API Docs</h1>
        <p className="mb-12 text-sm text-white/40">Quantalyze Public API — v1</p>

        <div className="space-y-14 text-[15px] leading-relaxed text-white/70">

          {/* Intro */}
          <section>
            <p>
              The Quantalyze API gives you programmatic access to the same
              management-credibility and narrative-shift intelligence that powers
              the Quantalyze product — earnings signal scores, sector dimensions,
              and sector thesis narratives for Indian equities. It&apos;s built for
              research desks, PMS/AIF teams, and platforms that want to embed this
              intelligence directly into their own workflow.
            </p>
          </section>

          {/* Base URL */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Base URL</h2>
            <p className="mb-3">Every endpoint below is relative to:</p>
            <CodeBlock code={BASE_URL} lang="bash" />
          </section>

          {/* Authentication */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Authentication</h2>
            <p className="mb-3">Every request must include your API key as a bearer token:</p>
            <CodeBlock code="Authorization: Bearer YOUR_API_KEY" lang="bash" />
            <p className="mt-4 mb-2">Requests fail before reaching any endpoint logic when:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code className="rounded bg-white/10 px-1 text-xs">401</code> — the{" "}
                <code className="rounded bg-white/10 px-1 text-xs">Authorization</code> header is
                missing or malformed
              </li>
              <li>
                <code className="rounded bg-white/10 px-1 text-xs">401</code> — the API key is
                invalid or has been deactivated
              </li>
              <li>
                <code className="rounded bg-white/10 px-1 text-xs">403</code> — the key is valid
                but not entitled to the requested product (
                <code className="rounded bg-white/10 px-1 text-xs">
                  key is not entitled to &apos;&lt;product&gt;&apos; — contact us to add this
                  product
                </code>
                )
              </li>
            </ul>
            <p className="mt-4">
              API keys are provisioned manually — see{" "}
              <Link href="#get-access" className="text-sky-400 hover:underline">
                Get API access
              </Link>{" "}
              below.
            </p>
          </section>

          {/* Endpoints */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Endpoints</h2>
            <p className="mb-8">
              Example responses below are illustrative placeholders showing field
              names, shapes, and types — not real analysis output.
            </p>

            <div className="space-y-12">

              {/* GET /data/companies/:ticker */}
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="rounded bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                    GET
                  </span>
                  <code className="text-sm text-white/90">/data/companies/&#123;ticker&#125;</code>
                  <span className="ml-auto text-xs text-white/30">
                    Product: <code className="rounded bg-white/10 px-1">data:companies</code>
                  </span>
                </div>
                <p className="mb-3">
                  Latest earnings-call analysis for a single company, identified by NSE ticker.
                </p>
                <table className="mb-4 w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-2 py-2 text-left font-medium text-white/60">Path Parameter</th>
                      <th className="px-2 py-2 text-left font-medium text-white/60">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-2 py-2 font-mono text-white/80">ticker</td>
                      <td className="px-2 py-2 text-white/60">
                        NSE ticker symbol, e.g. <code className="rounded bg-white/10 px-1 text-xs">RELIANCE</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <CodeBlock
                  lang="bash"
                  code={`curl -H "Authorization: Bearer YOUR_API_KEY" \\\n  ${BASE_URL}/data/companies/RELIANCE`}
                />
                <div className="mt-3">
                  <CodeBlock
                    lang="json"
                    code={JSON.stringify(
                      {
                        ticker: "RELIANCE",
                        quarter: "Q2 FY26",
                        quarterPrevious: "Q1 FY26",
                        overallSignal: "Positive",
                        overallScore: 7.8,
                        summary:
                          "Management raised full-year revenue guidance on strong retail and digital services growth, while flagging near-term margin pressure from refining spreads.",
                        keyMetrics: {
                          revenue: "₹2,43,000 Cr",
                          revenueGrowth: "+11.2% YoY",
                          ebitdaMargin: "16.8%",
                          patGrowth: "+8.4% YoY",
                        },
                        earningsDelta: [
                          "Raised FY26 revenue guidance from 'high single digits' to 'low double digits'",
                          "First explicit mention of refining margin pressure in three quarters",
                        ],
                        generatedAt: "2026-07-19T09:15:00.000Z",
                      },
                      null,
                      2
                    )}
                  />
                </div>
              </div>

              {/* GET /data/sectors/:sector */}
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="rounded bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                    GET
                  </span>
                  <code className="text-sm text-white/90">/data/sectors/&#123;sector&#125;</code>
                  <span className="ml-auto text-xs text-white/30">
                    Product: <code className="rounded bg-white/10 px-1">data:sectors</code>
                  </span>
                </div>
                <p className="mb-3">
                  Latest sector-level intelligence: scored dimensions and, where available, a
                  qualitative sector narrative.
                </p>
                <table className="mb-4 w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-2 py-2 text-left font-medium text-white/60">Path Parameter</th>
                      <th className="px-2 py-2 text-left font-medium text-white/60">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-2 py-2 font-mono text-white/80">sector</td>
                      <td className="px-2 py-2 text-white/60">
                        Sector code, e.g. <code className="rounded bg-white/10 px-1 text-xs">IT</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <CodeBlock
                  lang="bash"
                  code={`curl -H "Authorization: Bearer YOUR_API_KEY" \\\n  ${BASE_URL}/data/sectors/IT`}
                />
                <div className="mt-3">
                  <CodeBlock
                    lang="json"
                    code={JSON.stringify(
                      {
                        sector: "IT",
                        sectorLabel: "Information Technology",
                        quarter: "Q2 FY26",
                        companyCount: 12,
                        dimensions: [
                          {
                            dimension: "Deal Pipeline",
                            signal: "Strengthening on large-deal TCV growth",
                            direction: "strengthening",
                            weightedScore: 7.4,
                          },
                          {
                            dimension: "Margin Trajectory",
                            signal: "Stable despite wage hikes",
                            direction: "stable",
                            weightedScore: 6.1,
                          },
                        ],
                        narrative: {
                          competitiveStructure:
                            "Top-5 players consolidating large-deal share; mid-caps compete on niche verticals.",
                          strategicTheme:
                            "GenAI services monetization shifting from pilots to run-rate revenue.",
                          tailwinds: [
                            "Weaker rupee aiding realized margins",
                            "Discretionary spend recovery in BFSI vertical",
                          ],
                          headwinds: [
                            "Visa policy uncertainty in the US",
                            "Continued pricing pressure on legacy application services",
                          ],
                          keyTriggers: [
                            "Q3 large-deal TCV disclosures",
                            "US client budget-cycle commentary",
                          ],
                          macroSensitivity:
                            "High sensitivity to US discretionary tech spend and rupee-dollar movement.",
                          transformationSignal:
                            "Early signs of GenAI cannibalizing traditional staff-augmentation revenue.",
                        },
                        generatedAt: "2026-07-19T09:15:00.000Z",
                      },
                      null,
                      2
                    )}
                  />
                </div>
              </div>

              {/* GET /products/sector-thesis */}
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="rounded bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                    GET
                  </span>
                  <code className="text-sm text-white/90">/products/sector-thesis</code>
                  <span className="ml-auto text-xs text-white/30">
                    Product: <code className="rounded bg-white/10 px-1">products:sector-thesis</code>
                  </span>
                </div>
                <p className="mb-3">
                  A synthesized investment thesis for a sector: narrative, scored dimensions, and
                  the top-weighted companies driving the thesis.
                </p>
                <table className="mb-4 w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-2 py-2 text-left font-medium text-white/60">Query Parameter</th>
                      <th className="px-2 py-2 text-left font-medium text-white/60">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-2 py-2 font-mono text-white/80">sector</td>
                      <td className="px-2 py-2 text-white/60">
                        Required. Sector code, e.g. <code className="rounded bg-white/10 px-1 text-xs">IT</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <CodeBlock
                  lang="bash"
                  code={`curl -H "Authorization: Bearer YOUR_API_KEY" \\\n  "${BASE_URL}/products/sector-thesis?sector=IT"`}
                />
                <div className="mt-3">
                  <CodeBlock
                    lang="json"
                    code={JSON.stringify(
                      {
                        sector: "IT",
                        sectorLabel: "Information Technology",
                        quarter: "Q2 FY26",
                        quarterPrevious: "Q1 FY26",
                        companyCount: 12,
                        narrative: {
                          competitiveStructure:
                            "Top-5 players consolidating large-deal share; mid-caps compete on niche verticals.",
                          strategicTheme:
                            "GenAI services monetization shifting from pilots to run-rate revenue.",
                          tailwinds: [
                            "Weaker rupee aiding realized margins",
                            "Discretionary spend recovery in BFSI vertical",
                          ],
                          headwinds: [
                            "Visa policy uncertainty in the US",
                            "Continued pricing pressure on legacy application services",
                          ],
                          keyTriggers: [
                            "Q3 large-deal TCV disclosures",
                            "US client budget-cycle commentary",
                          ],
                          macroSensitivity:
                            "High sensitivity to US discretionary tech spend and rupee-dollar movement.",
                          transformationSignal:
                            "Early signs of GenAI cannibalizing traditional staff-augmentation revenue.",
                        },
                        dimensions: [
                          {
                            dimension: "Deal Pipeline",
                            signal: "Strengthening on large-deal TCV growth",
                            direction: "strengthening",
                            weightedScore: 7.4,
                          },
                          {
                            dimension: "Margin Trajectory",
                            signal: "Stable despite wage hikes",
                            direction: "stable",
                            weightedScore: 6.1,
                          },
                        ],
                        topCompanies: [
                          {
                            ticker: "TCS",
                            signal: "Steady execution, cautious near-term outlook",
                            direction: "neutral",
                            weightPct: 24.5,
                            topKpi: { name: "Large Deal TCV", changePct: 6.2 },
                            managementConfidence: "moderate",
                          },
                          {
                            ticker: "INFY",
                            signal: "Upgraded guidance on strong deal wins",
                            direction: "positive",
                            weightPct: 19.8,
                            topKpi: { name: "Revenue Growth", changePct: 4.1 },
                            managementConfidence: "high",
                          },
                        ],
                        generatedAt: "2026-07-19T09:15:00.000Z",
                      },
                      null,
                      2
                    )}
                  />
                </div>
              </div>

            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
