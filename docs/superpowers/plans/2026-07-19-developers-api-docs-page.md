# Developers API Docs Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, unauthenticated `/developers` page documenting the existing Public API v1 (base URL, auth, three endpoints, rate limits, errors, versioning), plus a footer link to it from the landing page.

**Architecture:** One new self-contained Server Component page (`app/developers/page.tsx`), following the dark-theme, single-file convention already used by `app/privacy/page.tsx` and `app/terms/page.tsx` (the other footer-linked secondary pages) rather than the landing page's light theme. A small in-file `CodeBlock` component plus two pure regex-based token functions (`highlightJson`, `highlightBash`) provide syntax highlighting with no new dependency. One line added to `app/page.tsx`'s existing footer links to the new page.

**Tech Stack:** Next.js 14 App Router, React Server Components, TypeScript, Tailwind CSS. No new npm dependencies.

## Global Constraints

- Documentation-only: no changes to `middleware.ts`, `lib/api-contracts/v1/*`, or any `app/api/public/v1/*` route handler.
- No new API endpoints, no self-serve key signup, no interactive "try it" console.
- No changes to `app/page.tsx` beyond one new footer link.
- Base URL documented throughout: `https://quantalyze.me/api/public/v1`.
- Example responses are illustrative placeholders (correct shape/types, not real proprietary analysis output) — the page states this once, explicitly, before the endpoint examples.
- Source of truth is the real implementation, not this page — every documented field, parameter, status code, and error message must be copied verbatim from the real source files, never invented: `middleware.ts`, `lib/public-api/product-routes.ts`, `lib/api-contracts/v1/company.ts`, `lib/api-contracts/v1/sector.ts`, `lib/api-contracts/v1/sectorThesis.ts`, `app/api/public/v1/data/companies/[ticker]/route.ts`, `app/api/public/v1/data/sectors/[sector]/route.ts`, `app/api/public/v1/products/sector-thesis/route.ts`.
- **No test framework exists in this repo** (confirmed: no Jest/Vitest, no `*.test.*` files, no `test` script in `package.json`). Do not introduce one for this task — that would be a disproportionate infra addition for one static content page. Verification per task is `npm run build` (Next.js's build performs full TypeScript type-checking and ESLint) plus manual dev-server visual checks, matching the approved spec's Testing section.
- Code blocks (curl, JSON) must sit inside their own `overflow-x-auto` container — the page body must never scroll horizontally.
- Semantic headings (`h1` once, `h2`/`h3` nested per section) and real `<table>`/`<th>` markup for the status-code table, not styled divs.

---

### Task 1: Page shell, syntax-highlighting helpers, Intro / Base URL / Authentication sections

**Files:**
- Create: `app/developers/page.tsx`

**Interfaces:**
- Produces: `function CodeBlock({ code, lang }: { code: string; lang: "bash" | "json" }): JSX.Element` — used by Task 2 and Task 3 for every code sample on the page.
- Produces: `BASE_URL = "https://quantalyze.me/api/public/v1"` and `CALENDLY = "https://calendly.com/quantalyze/say-hi"` module constants — reused by Task 2 (curl examples) and Task 3 (Get API Access CTA).

- [ ] **Step 1: Create the file with imports, constants, and the two highlight functions**

```tsx
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
```

- [ ] **Step 2: Add the page shell with header, Intro, Base URL, and Authentication sections**

Append below the code from Step 1, in the same file:

```tsx
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

        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors. `/developers` appears in the route list in the build output.

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`, then open `http://localhost:3000/developers`.
Expected: dark page renders with "Quantalyze" wordmark + "Sign in" link in the header, "API Docs" heading, Intro paragraph, a Base URL code block showing `https://quantalyze.me/api/public/v1` in plain (unhighlighted) monospace text, and an Authentication section whose `Authorization: Bearer YOUR_API_KEY` line renders in monospace with no console errors.

- [ ] **Step 5: Commit**

```bash
git add app/developers/page.tsx
git commit -m "feat: add developers API docs page shell with syntax-highlighted code blocks"
```

---

### Task 2: Endpoints section (three endpoint blocks)

**Files:**
- Modify: `app/developers/page.tsx` (insert a new `<section>` immediately after the Authentication `</section>` added in Task 1 Step 2, still inside the `<div className="space-y-14 ...">` container)

**Interfaces:**
- Consumes: `CodeBlock({ code, lang })` and `BASE_URL` from Task 1.

- [ ] **Step 1: Insert the Endpoints section**

Insert this `<section>` directly after the Authentication section's closing `</section>` tag (before the container `</div>` that closes `space-y-14`):

```tsx
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
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors.

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev`, open `http://localhost:3000/developers`.
Expected: three endpoint blocks render in order (companies, sectors, sector-thesis), each with a GET badge, product entitlement name, a parameter table, a curl example, and a JSON example. In the JSON blocks, keys render in blue, string values in green, numbers in amber. Widen and narrow the browser window — code blocks scroll horizontally inside their own box; the page itself never scrolls sideways.

- [ ] **Step 4: Commit**

```bash
git add app/developers/page.tsx
git commit -m "feat: add endpoints section to developers API docs page"
```

---

### Task 3: Rate limits, Errors, Versioning, Get API Access, footer

**Files:**
- Modify: `app/developers/page.tsx` (insert new sections after the Endpoints section's closing `</section>`, still inside `<div className="space-y-14 ...">`; add a `<footer>` after `</main>`)

**Interfaces:**
- Consumes: `CodeBlock`, `CALENDLY` from Task 1.

- [ ] **Step 1: Insert Rate Limits, Errors, Versioning, and Get API Access sections**

Insert directly after the Endpoints section's closing `</section>` tag (before the container `</div>` that closes `space-y-14`):

```tsx
          {/* Rate limits */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Rate Limits</h2>
            <p>
              Each API key has a daily request quota set per partner when the key is provisioned.
              Exceeding it returns:
            </p>
            <div className="mt-3">
              <CodeBlock lang="json" code={JSON.stringify({ error: "daily rate limit exceeded" }, null, 2)} />
            </div>
            <p className="mt-3 text-sm text-white/50">
              Quota is configured per partner, not a fixed platform-wide number.
            </p>
          </section>

          {/* Errors */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Errors</h2>
            <p className="mb-4">Every endpoint returns errors in the same shape:</p>
            <CodeBlock lang="json" code={JSON.stringify({ error: "string" }, null, 2)} />
            <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left font-medium text-white/80">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-white/80">Meaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    ["400", "Bad request — e.g. a required query parameter is missing"],
                    ["401", "Missing/malformed Authorization header, or an invalid/inactive API key"],
                    ["403", "Key is valid but not entitled to the requested product"],
                    ["404", "No data available for the given ticker or sector"],
                    ["429", "Daily rate limit exceeded"],
                    ["500", "Internal error"],
                  ].map(([code, meaning]) => (
                    <tr key={code}>
                      <td className="px-4 py-3 font-mono text-white/80">{code}</td>
                      <td className="px-4 py-3 text-white/60">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Versioning */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Versioning</h2>
            <p>
              This page documents <code className="rounded bg-white/10 px-1 text-xs">v1</code>,
              matching the <code className="rounded bg-white/10 px-1 text-xs">/api/public/v1/*</code>{" "}
              path prefix used above. Future breaking changes ship as a new path prefix (
              <code className="rounded bg-white/10 px-1 text-xs">/api/public/v2/*</code>) rather
              than breaking changes within v1 — existing integrations on v1 keep working unchanged.
            </p>
          </section>

          {/* Get API access */}
          <section id="get-access">
            <h2 className="mb-3 text-base font-semibold text-white">Get API Access</h2>
            <p className="mb-5">
              There&apos;s no self-serve signup yet — API keys are provisioned manually. Tell us
              what you&apos;re building and we&apos;ll set you up.
            </p>
            <a
              href={CALENDLY}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-full border border-white/20 bg-white/5 px-6 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/10"
            >
              Get in touch
            </a>
          </section>
```

- [ ] **Step 2: Add the footer**

Insert immediately after `</main>` (before the closing `</div>` of the page's root element):

```tsx
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 px-6 py-8 text-xs text-white/30 sm:flex-row">
          <span>© {new Date().getFullYear()} Quantalyze. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white/60 transition">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white/60 transition">Terms of Service</Link>
          </div>
        </div>
      </footer>
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors.

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`, open `http://localhost:3000/developers`.
Expected: page now ends with Rate Limits, Errors (with a real 6-row status table), Versioning, and Get API Access sections, followed by a footer with Privacy Policy / Terms of Service links. Clicking "Get in touch" opens `https://calendly.com/quantalyze/say-hi` in a new tab. Clicking the "Get API access" link in the Authentication section (added in Task 1) scrolls down to the Get API Access section.

- [ ] **Step 5: Commit**

```bash
git add app/developers/page.tsx
git commit -m "feat: add rate limits, errors, versioning, and CTA sections to developers API docs page"
```

---

### Task 4: Footer link from the landing page, final cross-check

**Files:**
- Modify: `app/page.tsx:339-348`

**Interfaces:**
- Consumes: the `/developers` route created in Tasks 1-3.

- [ ] **Step 1: Add the "API Docs" link to the landing page footer**

In `app/page.tsx`, replace the footer block:

```tsx
      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-[11px] text-gray-400 sm:flex-row">
          <span>© {new Date().getFullYear()} Quantalyze by Demandion</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-gray-700 transition">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-700 transition">Terms</Link>
            <a href="mailto:support@demandion.ai" className="hover:text-gray-700 transition">support@demandion.ai</a>
          </div>
        </div>
      </footer>
```

with:

```tsx
      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-[11px] text-gray-400 sm:flex-row">
          <span>© {new Date().getFullYear()} Quantalyze by Demandion</span>
          <div className="flex gap-6">
            <Link href="/developers" className="hover:text-gray-700 transition">API Docs</Link>
            <Link href="/privacy" className="hover:text-gray-700 transition">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-700 transition">Terms</Link>
            <a href="mailto:support@demandion.ai" className="hover:text-gray-700 transition">support@demandion.ai</a>
          </div>
        </div>
      </footer>
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors.

- [ ] **Step 3: Manually verify the footer link**

Run: `npm run dev`, open `http://localhost:3000/`, scroll to the footer.
Expected: "API Docs" link appears before "Privacy", styled identically to the other footer links. Clicking it navigates to `/developers`.

- [ ] **Step 4: Cross-check every documented detail against the real source**

Read each file below and confirm every field name, status code, and error message on the `/developers` page matches exactly — fix any mismatch found before proceeding:

- `middleware.ts` — confirm the 401/403/429 messages on the page (`"missing or malformed Authorization header"`, `"invalid or inactive API key"`, `"key is not entitled to '<product>' — contact us to add this product"`, `"daily rate limit exceeded"`) match `middleware.ts` verbatim.
- `lib/public-api/product-routes.ts` — confirm the three product names on the page (`data:companies`, `data:sectors`, `products:sector-thesis`) match the `PRODUCT_ROUTES` entries verbatim.
- `lib/api-contracts/v1/company.ts` — confirm every field in the `CompanyResponseV1` JSON example (`ticker`, `quarter`, `quarterPrevious`, `overallSignal`, `overallScore`, `summary`, `keyMetrics.revenue`, `keyMetrics.revenueGrowth`, `keyMetrics.ebitdaMargin`, `keyMetrics.patGrowth`, `earningsDelta`, `generatedAt`) exists on `CompanyResponseV1` with no extra or missing fields.
- `lib/api-contracts/v1/sector.ts` — confirm every field in the `SectorResponseV1` JSON example (`sector`, `sectorLabel`, `quarter`, `companyCount`, `dimensions[].dimension/signal/direction/weightedScore`, `narrative.competitiveStructure/strategicTheme/tailwinds/headwinds/keyTriggers/macroSensitivity/transformationSignal`, `generatedAt`) matches `SectorResponseV1`/`SectorDimensionV1`/`SectorNarrativeV1` with no extra or missing fields.
- `lib/api-contracts/v1/sectorThesis.ts` — confirm every field in the `SectorThesisResponseV1` JSON example (including `topCompanies[].ticker/signal/direction/weightPct/topKpi/managementConfidence`) matches `SectorThesisResponseV1`/`SectorThesisCompanyV1` with no extra or missing fields.
- `app/api/public/v1/data/companies/[ticker]/route.ts` and `app/api/public/v1/data/sectors/[sector]/route.ts` — confirm both are `GET`, take a path parameter, and return 404 via `NotFoundError` (not documented with an invented message beyond the generic "no data available" wording already on the page).
- `app/api/public/v1/products/sector-thesis/route.ts` — confirm it's `GET`, takes `sector` as a required query parameter, and returns 400 `"sector query param required"` when missing (this 400 case is covered by the generic Errors table row, not called out per-endpoint — no change needed unless the route has changed).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: link to developers API docs page from landing page footer"
```

---

## Self-Review

**Spec coverage:** Intro (Task 1), Base URL (Task 1), Authentication (Task 1), Endpoints × 3 (Task 2), Rate limits (Task 3), Errors (Task 3), Versioning (Task 3), Get API Access (Task 3), footer link (Task 4), responsive/overflow handling (`CodeBlock`'s `overflow-x-auto`, Task 1), syntax highlighting (`highlightJson`/`highlightBash`, Task 1), accessibility (semantic headings + real `<table>` throughout), illustrative-data disclaimer (Task 2 Step 1), source-of-truth cross-check (Task 4 Step 4) — all covered.

**Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code; no "similar to Task N" references — full JSX repeated in each task since implementers may work out of order.

**Type consistency:** `CodeBlock({ code, lang })` signature and `lang: "bash" | "json"` union are identical across Tasks 1-3. `BASE_URL` and `CALENDLY` constants are defined once in Task 1 and only referenced (never redefined) in Tasks 2-3.
