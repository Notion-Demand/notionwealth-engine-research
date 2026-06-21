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
    <div className="min-h-screen bg-[#0A0A0A] text-white overflow-hidden">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-base font-semibold tracking-[0.2em] uppercase text-white/90">
          Quantalyze
        </span>
        <div className="flex items-center gap-4">
          <a
            href="https://calendly.com/quantalyze/say-hi"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-white/20 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-wider text-[#0A0A0A] transition hover:bg-white/90"
          >
            Book a Demo
          </a>
          <Link
            href="/login"
            className="text-xs font-medium uppercase tracking-wider text-white/50 transition hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 pt-20 pb-32">

        {/* Background grid lines */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />

        {/* Floating intelligence cards (right side) */}
        <div className="absolute right-0 top-16 w-[420px] hidden lg:block">
          {/* Main intelligence panel */}
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-5 shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Live Intelligence</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
                <span className="text-xs text-white/70">Revenue Momentum</span>
                <span className="text-xs font-semibold text-emerald-400">Accelerating</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
                <span className="text-xs text-white/70">Management Credibility</span>
                <span className="text-xs font-mono font-semibold text-white">8.9<span className="text-white/30">/10</span></span>
              </div>
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
                <span className="text-xs text-white/70">Promoter Activity</span>
                <span className="text-xs font-semibold text-emerald-400">Healthy</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
                <span className="text-xs text-white/70">Evasiveness Score</span>
                <span className="text-xs font-mono font-semibold text-white">2.1<span className="text-white/30">/10</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/70">Margin Outlook</span>
                <span className="text-xs font-semibold text-amber-400">Improving</span>
              </div>
            </div>
          </div>

          {/* Floating signal cards */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2">
              <p className="text-[10px] text-emerald-300/80">Narrative changed on pricing strategy</p>
            </div>
            <div className="rounded border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
              <p className="text-[10px] text-amber-300/80">Capex timeline delayed 2 quarters</p>
            </div>
            <div className="rounded border border-sky-500/20 bg-sky-500/[0.05] px-3 py-2">
              <p className="text-[10px] text-sky-300/80">Input cost pressure easing</p>
            </div>
            <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2">
              <p className="text-[10px] text-emerald-300/80">China+1 demand accelerating</p>
            </div>
          </div>
        </div>

        {/* Hero text (left aligned) */}
        <div className="relative z-10 max-w-2xl">
          <p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-400/80">
            Institutional Intelligence Platform
          </p>

          <h1 className="mb-8 text-4xl font-bold leading-[1.15] tracking-tight text-white md:text-[3.5rem]">
            The most important thing in an earnings call
            <br />
            <span className="text-white/40">is usually said once.</span>
          </h1>

          <p className="mb-10 max-w-lg text-base text-white/40 leading-relaxed">
            Quantalyze finds it before the market does. Management credibility.
            Narrative shifts. Guidance quality. Promoter behavior. Sector signals.
            All tracked, cross-referenced, and surfaced — every quarter.
          </p>

          <div className="flex items-center gap-5">
            <a
              href="https://calendly.com/quantalyze/say-hi"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-white/20 bg-white px-7 py-3 text-xs font-semibold uppercase tracking-wider text-[#0A0A0A] transition hover:bg-white/90 shadow-lg shadow-white/5"
            >
              Book a Demo
            </a>
            <Link
              href="/login"
              className="text-xs font-medium uppercase tracking-wider text-white/40 transition hover:text-white"
            >
              Sign in &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* ── Contrast strip ──────────────────────────────────────────────── */}
      <section className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-6 py-14 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          {/* Left: The problem */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-red-400/60 mb-3">Without Quantalyze</p>
            <div className="space-y-2 text-sm text-white/30">
              <p>147-page transcripts</p>
              <p>Management jargon buried in boilerplate</p>
              <p>Hidden signals in Q&A</p>
              <p>Contradictions across quarters missed</p>
              <p>Guidance changes untracked</p>
              <p>Promoter activity unchecked</p>
            </div>
          </div>
          {/* Right: The intelligence */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400/60 mb-3">With Quantalyze</p>
            <div className="space-y-2 text-sm text-white/70">
              <p className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-emerald-400" /> Revenue narrative changed — pricing power intact</p>
              <p className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-emerald-400" /> Margin pressure easing — cost pass-through complete</p>
              <p className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-emerald-400" /> Promoter activity normal — no red flags</p>
              <p className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-emerald-400" /> Guidance credibility 9.1/10 — delivered on promises</p>
              <p className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-emerald-400" /> New growth driver detected — railroad entry</p>
              <p className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-emerald-400" /> Management evasiveness low — direct answers</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Intelligence modules ────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/30 mb-3">Intelligence Modules</p>
        <h2 className="text-2xl font-bold text-white mb-12">Six layers of earnings intelligence.</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.06] rounded-xl overflow-hidden">
          {[
            {
              label: "01",
              title: "Deep Dive Analysis",
              body: "8-14 section single-quarter brief. Segment performance, pricing mechanics, channel dynamics, capex, growth outlook. Management quotes with causation links.",
            },
            {
              label: "02",
              title: "Delta Analysis",
              body: "Quarter-over-quarter narrative shift detection across Revenue, Margins, Costs, CapEx, Macro. What management changed in their language — not the numbers.",
            },
            {
              label: "03",
              title: "Guidance Credibility Engine",
              body: "Tracks what management promised vs delivered. Scores credibility 0-10. Flags abandoned guidance, downgraded timelines, contradictions.",
            },
            {
              label: "04",
              title: "Executive Evasiveness Score",
              body: "Quantifies deflection in Q&A. Detects pivot-to-talking-points, non-answers, excessive hedging. Scored 0-10 with reasoning.",
            },
            {
              label: "05",
              title: "Promoter Pledge Monitor",
              body: "SEBI Reg. 31 disclosures scanned. 90-day activity vs 15-month baseline. Cross-referenced with concall sentiment for divergence detection.",
            },
            {
              label: "06",
              title: "Sector Intelligence",
              body: "17 sectors, 65 companies. Aggregated narratives, competitive structure, tailwinds/headwinds, key triggers, macro sensitivity — PM-grade.",
            },
          ].map((f) => (
            <div key={f.title} className="bg-[#0A0A0A] px-6 py-7">
              <span className="text-[10px] font-mono text-white/20 mb-2 block">{f.label}</span>
              <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-xs leading-relaxed text-white/35">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Multi-Quarter Pointer Sheet ─────────────────────────────────── */}
      <section className="border-t border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/30 mb-3">Multi-Quarter Tracking</p>
          <h2 className="text-2xl font-bold text-white mb-4">Your automated earnings pointer sheet.</h2>
          <p className="text-sm text-white/35 mb-10 max-w-xl">Every dimension tracked across quarters — financials, growth outlook, margins, cost control, capex, customers, macro, themes, guidance, product launches.</p>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {[
              "Financials", "Growth Outlook", "Margins", "Cost Control",
              "Capex & Capacity", "Customers & Market", "Macro & News",
              "Recurring Themes", "Guidance Tracker", "Product Updates",
            ].map((tab) => (
              <div key={tab} className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-center">
                <span className="text-[11px] font-medium text-white/50">{tab}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coverage ────────────────────────────────────────────────────── */}
      <section className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl font-bold text-white">200</p>
              <p className="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Nifty Companies</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">500</p>
              <p className="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Concall Videos</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">17</p>
              <p className="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Sectors Tracked</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">60s</p>
              <p className="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Per Analysis</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Positioning ─────────────────────────────────────────────────── */}
      <section className="border-t border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <p className="text-sm text-white/25 mb-6 italic">
            Retail investors get data. Institutions get intelligence.
          </p>
          <h2 className="text-3xl font-bold text-white mb-4">
            Quantalyze gives you intelligence.
          </h2>
          <p className="text-sm text-white/35 mb-10 max-w-md mx-auto">
            Built for portfolio managers, equity research desks, wealth management firms, and family offices who need to track management behavior — not just numbers.
          </p>
          <a
            href="https://calendly.com/quantalyze/say-hi"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded border border-white/20 bg-white px-8 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#0A0A0A] transition hover:bg-white/90 shadow-lg shadow-white/5"
          >
            Book a Demo
          </a>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-[11px] text-white/20 sm:flex-row">
          <span>© {new Date().getFullYear()} Quantalyze by Demandion</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white/50 transition">Privacy</Link>
            <Link href="/terms" className="hover:text-white/50 transition">Terms</Link>
            <a href="mailto:support@demandion.ai" className="hover:text-white/50 transition">support@demandion.ai</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
