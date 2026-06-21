import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-[#0a1628] text-white">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight text-white">
          Quantalyze
        </span>
        <div className="flex items-center gap-3">
          <a
            href="https://calendly.com/quantalyze/say-hi"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
          >
            Book a Demo
          </a>
          <Link
            href="/login"
            className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-24 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-400">
          Now Live — Nifty 200 + Top 500 Coverage
        </div>

        <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-white md:text-6xl">
          Earnings concall intelligence
          <br />
          <span className="text-sky-400">in 60 seconds.</span>
        </h1>

        <p className="mx-auto mb-10 max-w-xl text-lg text-white/50 leading-relaxed">
          What a 3-analyst team builds in 2 days per company, Quantalyze delivers
          in 60 seconds across 200 companies — and catches shifts human readers miss.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="rounded-full bg-sky-500 px-8 py-3 text-sm font-semibold text-white transition hover:bg-sky-400"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-white/15 px-8 py-3 text-sm font-medium text-white/70 transition hover:border-white/30 hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* ── Section 1: Concall Analysis Engine ─────────────────────────── */}
      <section className="border-t border-white/10 bg-white/[0.04]">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold text-white mb-2">Concall Analysis Engine</h2>
          <p className="text-sm text-white/40 mb-8">Deep AI-powered analysis of every earnings call</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: "Deep Dive Analysis",
                body: "Comprehensive single-quarter earnings brief (8-14 sections) covering segment performance, pricing mechanics, channel dynamics, capex, and growth outlook — richer than Tijori or Screener, with management quotes and causation links.",
              },
              {
                title: "Delta Analysis (Quarter-over-Quarter)",
                body: "Detects what management changed in their language between two quarters across 5 domains: Revenue, Margins, Costs, CapEx, and Macro/Risk. Surfaces narrative shifts others miss.",
              },
              {
                title: "Promoter Pledge Activity Monitor",
                body: "Scans SEBI Reg. 31 disclosures, compares last 90 days vs 15-month baseline, cross-references with concall sentiment. Green \"Healthy\" for clean stocks, amber/red flags for elevated activity.",
              },
              {
                title: "Executive Evasiveness Score",
                body: "Quantifies how much management dodges questions in Q&A (0-10 scale). Catches deflection, non-answers, and pivot-to-talking-points behavior.",
              },
              {
                title: "Branded PDF Downloads",
                body: "Export Deep Dive or Delta analysis as professional PDFs with Quantalyze branding + transcript download.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-white/10 bg-white/[0.06] px-6 py-5">
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm leading-relaxed text-white/45">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 2: Multi-Quarter Insights ──────────────────────────── */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold text-white mb-2">Multi-Quarter Insights</h2>
          <p className="text-sm text-white/40 mb-8">Your automated earnings pointer sheet — tracked across quarters</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                title: "Financials Tracker",
                body: "Revenue, PAT, margins, volume/realisation extracted per quarter with exact numbers — like maintaining your own pointer sheet automatically.",
              },
              {
                title: "Growth Outlook Tracker",
                body: "CAGR targets, recovery timelines, demand visibility, management confidence tracked quarter-over-quarter.",
              },
              {
                title: "Margins & Cost Control",
                body: "Separate tabs for margin trajectory AND cost reduction initiatives (power savings, input costs, operational efficiencies) with quantified savings.",
              },
              {
                title: "Capex & Capacity Tracker",
                body: "Expansion plans, utilization %, commissioning timelines, GF/BF/debottlenecking — all tracked across quarters.",
              },
              {
                title: "Customers & Market Position",
                body: "Customer concentration, de-risking progress, new industry additions, China+1 opportunities, order book composition.",
              },
              {
                title: "Macro & News",
                body: "Both stated-in-call factors AND external context relevant to the firm — each bullet tagged [Stated] or [Context].",
              },
              {
                title: "Recurring Themes Detection",
                body: "AI identifies themes that persist across 2+ quarters and tracks their evolution (improving/declining/dropped/newly emerging).",
              },
              {
                title: "Guidance Tracker",
                body: "Tracks what management promised vs delivered. Scores credibility 0-10 based on guidance consistency across quarters.",
              },
              {
                title: "Product Updates & New Launches",
                body: "New customer wins, geographies, products, partnerships grouped by quarter with type icons.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-white/10 bg-white/[0.06] px-5 py-4">
                <h3 className="text-xs font-semibold text-sky-400 mb-1.5">{f.title}</h3>
                <p className="text-xs leading-relaxed text-white/45">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 3: Coverage & Discovery ────────────────────────────── */}
      <section className="border-t border-white/10 bg-white/[0.04]">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold text-white mb-2">Coverage & Discovery</h2>
          <p className="text-sm text-white/40 mb-8">Full market coverage with smart discovery tools</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                title: "Nifty 200 Universe",
                body: "Full coverage of India's top 200 companies with automatic transcript fetching.",
              },
              {
                title: "Sector Intelligence",
                body: "Aggregated sector-level narratives across 17 sectors / 65 companies. See which sector themes are strengthening or weakening.",
              },
              {
                title: "Earnings Calendar",
                body: "Upcoming concall dates so you never miss a result.",
              },
              {
                title: "Screener",
                body: "Filter companies by signal strength, evasiveness, divergence across the universe.",
              },
              {
                title: "Concall Videos",
                body: "YouTube concall recordings linked/embedded per company per quarter for quick playback.",
              },
              {
                title: "Watchlist + Keyboard Navigation",
                body: "Personal watchlist (up to 20 stocks), CSV bulk import, arrow-key cycling between stocks for rapid research workflow.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-white/10 bg-white/[0.06] px-5 py-4">
                <h3 className="text-xs font-semibold text-white mb-1.5">{f.title}</h3>
                <p className="text-xs leading-relaxed text-white/45">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof / positioning ───────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-white/30">
          Built for
        </p>
        <div className="flex flex-wrap justify-center gap-x-10 gap-y-4 text-sm font-medium text-white/40">
          {[
            "Portfolio management teams",
            "Equity research desks",
            "Wealth management firms",
            "Family offices",
            "Independent analysts",
          ].map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </section>

      {/* ── CTA banner ──────────────────────────────────────────────────── */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white">
            Stop reading transcripts. Start reading narratives.
          </h2>
          <p className="mb-8 text-white/45">
            Every Nifty 200 company, every concall, in under a minute.
          </p>
          <Link
            href="/login"
            className="inline-flex rounded-full bg-sky-500 px-8 py-3 text-sm font-semibold text-white transition hover:bg-sky-400"
          >
            Get started
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-xs text-white/30 sm:flex-row">
          <span>© {new Date().getFullYear()} Quantalyze by Demandion. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white/60 transition">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white/60 transition">Terms of Service</Link>
            <a href="mailto:support@demandion.ai" className="hover:text-white/60 transition">support@demandion.ai</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
