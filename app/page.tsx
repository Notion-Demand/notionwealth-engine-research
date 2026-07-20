import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const user = await getCurrentUser();

  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 border-b border-gray-100">
        <span className="text-base font-semibold tracking-[0.15em] uppercase text-gray-900">
          Quantalyze
        </span>
        <div className="flex items-center gap-4">
          <a
            href="https://calendly.com/quantalyze/say-hi"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-gray-900 bg-gray-900 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-gray-800"
          >
            Book a Demo
          </a>
          <Link
            href="/login"
            className="text-xs font-medium text-gray-500 transition hover:text-gray-900"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-20">

        {/* Intelligence panel (right) */}
        <div className="absolute right-6 top-20 w-[360px] hidden lg:block">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Asian Paints · Q4 FY26</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </div>
            <div className="space-y-3 mt-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Guidance Credibility</span>
                <span className="text-xs font-mono font-semibold text-emerald-600">8.9<span className="text-gray-400">/10</span></span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Executive Evasiveness</span>
                <span className="text-xs font-mono font-semibold text-emerald-600">2.1<span className="text-gray-400">/10</span></span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Promoter Activity</span>
                <span className="text-xs font-semibold text-emerald-600">Healthy</span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Margin Outlook</span>
                <span className="text-xs font-semibold text-amber-600">Improving</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Revenue Momentum</span>
                <span className="text-xs font-semibold text-emerald-600">Accelerating</span>
              </div>
            </div>
          </div>

          {/* Narrative shift example */}
          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Narrative Shift Detected</p>
            <div className="space-y-2">
              <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
                <p className="text-[10px] text-gray-400 mb-0.5">Q3 FY26</p>
                <p className="text-xs text-gray-600 italic">&ldquo;Demand remains robust across export markets.&rdquo;</p>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[10px] text-amber-600 mb-0.5">Q4 FY26</p>
                <p className="text-xs text-amber-800 italic">&ldquo;Near-term export visibility remains uncertain.&rdquo;</p>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">Weakening outlook signal — management confidence dropped.</p>
          </div>
        </div>

        {/* Hero text */}
        <div className="max-w-xl">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400">
            AI Research Platform for Indian Equity Investors
          </p>
          <h1 className="mb-6 text-3xl font-bold leading-[1.2] tracking-tight text-gray-900 md:text-[2.75rem]">
            Track management credibility.
            <br />Spot narrative shifts.
            <br />Build conviction faster.
          </h1>

          <p className="mb-8 max-w-lg text-base text-gray-500 leading-relaxed">
            Quantalyze compares management commentary across quarters and identifies changes
            in outlook, capital allocation, margin expectations, and risk disclosures — across
            200+ Indian equities.
          </p>

          <div className="flex items-center gap-5">
            <a
              href="https://calendly.com/quantalyze/say-hi"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-gray-900 bg-gray-900 px-7 py-3 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-gray-800"
            >
              Book a Demo
            </a>
            <Link
              href="/login"
              className="text-xs font-medium text-gray-400 transition hover:text-gray-900"
            >
              Sign in &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* ── 3 Core Signals ──────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-8">Signals That Matter</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Management Credibility</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Track what management promised versus what they delivered. Scored 0-10 across quarters.
                Flags abandoned guidance, downgraded timelines, and contradictions.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Narrative Shift Detection</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                See what changed in management commentary between quarters. Revenue outlook, margin
                expectations, capex posture, risk language — tracked and classified.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Executive Evasiveness</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Quantify when management avoids answering difficult questions. Detects deflection,
                non-answers, and pivot-to-talking-points behavior in Q&A.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Why Analysts Use Quantalyze ─────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-8">Why Analysts Switch</p>
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Traditional Workflow</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wide text-gray-900">With Quantalyze</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-6 py-3 text-gray-400">Read 70-page transcript</td>
                  <td className="px-6 py-3 text-gray-800 font-medium">5-minute Deep Dive</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-gray-400">Compare quarters manually</td>
                  <td className="px-6 py-3 text-gray-800 font-medium">Automated Delta Analysis</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-gray-400">Track guidance in spreadsheets</td>
                  <td className="px-6 py-3 text-gray-800 font-medium">Guidance Tracker with Credibility Score</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-gray-400">Judge management qualitatively</td>
                  <td className="px-6 py-3 text-gray-800 font-medium">Credibility + Evasiveness Scores</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-gray-400">Check promoter filings manually</td>
                  <td className="px-6 py-3 text-gray-800 font-medium">Promoter Pledge Monitor (auto)</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-gray-400">Maintain pointer sheets per stock</td>
                  <td className="px-6 py-3 text-gray-800 font-medium">Multi-Quarter Tracking (11 dimensions)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Proprietary Signals ─────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-3">Proprietary Signals</p>
          <h2 className="text-xl font-bold text-gray-900 mb-8">Signals Quantalyze tracks that others don't.</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              "Guidance Credibility",
              "Executive Evasiveness",
              "Promoter Pledge Activity",
              "Recurring Themes",
              "Management Confidence",
              "Sector Narrative Shifts",
            ].map((s) => (
              <div key={s} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-gray-800">{s}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Product Video ──────────────────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-4 text-center">See It In Action</p>
          <div className="aspect-video w-full rounded-xl overflow-hidden border border-gray-200 shadow-lg">
            <iframe
              src="https://www.youtube.com/embed/b_47D3djj8c?rel=0&modestbranding=1"
              title="Quantalyze Product Demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        </div>
      </section>

      {/* ── Who It's For ────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-8">Built For</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { role: "PMS Analysts", outcome: "Cover more companies" },
              { role: "AIF Research Teams", outcome: "Spot risks earlier" },
              { role: "Family Offices", outcome: "Track management behavior" },
              { role: "Wealth Managers", outcome: "Brief clients faster" },
              { role: "Serious Investors", outcome: "Build conviction faster" },
            ].map((p) => (
              <div key={p.role} className="text-center">
                <p className="text-sm font-semibold text-gray-900">{p.role}</p>
                <p className="text-xs text-gray-400 mt-0.5">{p.outcome}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coverage stats ──────────────────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl font-bold text-gray-900">200+</p>
              <p className="text-[11px] text-gray-400 mt-1">Companies Covered</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">17</p>
              <p className="text-[11px] text-gray-400 mt-1">Sectors Tracked</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">11</p>
              <p className="text-[11px] text-gray-400 mt-1">Dimensions Per Quarter</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">60s</p>
              <p className="text-[11px] text-gray-400 mt-1">Per Analysis</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Value Propositions ──────────────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-8">What Changes For Your Team</p>
          <div className="space-y-6">
            {[
              {
                bold: "Cover 3x more companies with the same analyst team.",
                detail: "What took 2 days per company now runs in 60 seconds. Your analysts cover 100s of companies instead of a few.",
              },
              {
                bold: "Detect what changed.",
                detail: "Quarter-over-quarter delta analysis surfaces exactly what shifted in management language — outlook, margins, capex, risk — so you read what matters, not everything.",
              },
              {
                bold: "Quantify management quality.",
                detail: "Executive Evasiveness Score tells you when management dodges tough questions. Guidance Credibility Score tells you whether they deliver on promises. Numbers, not gut feel.",
              },
              {
                bold: "Decide where to allocate capital.",
                detail: "Guidance credibility, promoter pledge activity, sector intelligence, recurring themes, margin trajectory — the signals that drive allocation decisions, all in one place.",
              },
              {
                bold: "Indispensable if you're time-constrained or research-constrained.",
                detail: "Whether you're a 2-person PMS or a 20-person research desk, Quantalyze makes every analyst 3x more productive. The tool pays for itself in the first week.",
              },
            ].map((v) => (
              <div key={v.bold} className="flex gap-4 items-start">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-gray-900 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">{v.bold}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{v.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            The fastest way to track management credibility and narrative shifts across Indian equities.
          </h2>
          <p className="text-sm text-gray-500 mb-8 max-w-md mx-auto">
            Concall intelligence in 60 seconds. 10x more comprehensive than anything in the market.
          </p>
          <a
            href="https://calendly.com/quantalyze/say-hi"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded border border-gray-900 bg-gray-900 px-8 py-3.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-gray-800"
          >
            Book a Demo
          </a>
        </div>
      </section>

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
    </div>
  );
}
