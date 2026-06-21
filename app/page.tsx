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
      <section className="relative mx-auto max-w-6xl px-6 pt-24 pb-28">

        {/* Floating intelligence panel (right) */}
        <div className="absolute right-6 top-20 w-[380px] hidden lg:block">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Live Intelligence</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Revenue Momentum</span>
                <span className="text-xs font-semibold text-emerald-600">Accelerating</span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Management Credibility</span>
                <span className="text-xs font-mono font-semibold text-gray-900">8.9<span className="text-gray-400">/10</span></span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Promoter Activity</span>
                <span className="text-xs font-semibold text-emerald-600">Healthy</span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <span className="text-xs text-gray-600">Evasiveness Score</span>
                <span className="text-xs font-mono font-semibold text-gray-900">2.1<span className="text-gray-400">/10</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Margin Outlook</span>
                <span className="text-xs font-semibold text-amber-600">Improving</span>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-[10px] text-emerald-700">Narrative changed on pricing</p>
            </div>
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[10px] text-amber-700">Capex delayed 2 quarters</p>
            </div>
            <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2">
              <p className="text-[10px] text-sky-700">Input cost pressure easing</p>
            </div>
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-[10px] text-emerald-700">China+1 demand accelerating</p>
            </div>
          </div>
        </div>

        {/* Hero text */}
        <div className="max-w-2xl">
          <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400">
            Earnings Intelligence Platform
          </p>

          <h1 className="mb-7 text-4xl font-bold leading-[1.15] tracking-tight text-gray-900 md:text-[3.5rem]">
            The most important thing in an earnings call
            <span className="text-gray-300"> is usually said once.</span>
          </h1>

          <p className="mb-10 max-w-lg text-base text-gray-500 leading-relaxed">
            Quantalyze finds it before the market does. Management credibility.
            Narrative shifts. Guidance quality. Promoter behavior. Sector signals.
            All tracked and cross-referenced — every quarter, across 200 companies.
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

      {/* ── Contrast strip ──────────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-14 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-red-400 mb-3">Without Quantalyze</p>
            <div className="space-y-2 text-sm text-gray-400">
              <p>147-page transcripts</p>
              <p>Management jargon buried in boilerplate</p>
              <p>Hidden signals in Q&A</p>
              <p>Contradictions across quarters missed</p>
              <p>Guidance changes untracked</p>
              <p>Promoter activity unchecked</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-600 mb-3">With Quantalyze</p>
            <div className="space-y-2 text-sm text-gray-700">
              <p className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Revenue narrative changed — pricing power intact</p>
              <p className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Margin pressure easing — cost pass-through complete</p>
              <p className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Promoter activity normal — no red flags</p>
              <p className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Guidance credibility 9.1/10 — delivered on promises</p>
              <p className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> New growth driver detected — railroad entry</p>
              <p className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Management evasiveness low — direct answers</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product video ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-4 text-center">See it in action</p>
        <div className="aspect-video w-full rounded-xl overflow-hidden border border-gray-200 shadow-lg">
          <iframe
            src="https://www.youtube.com/embed/b_47D3djj8c?rel=0&modestbranding=1"
            title="Quantalyze Product Demo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        </div>
      </section>

      {/* ── Intelligence modules ────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-3">Intelligence Modules</p>
        <h2 className="text-2xl font-bold text-gray-900 mb-12">Six layers of earnings intelligence.</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-200 rounded-xl overflow-hidden">
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
            <div key={f.title} className="bg-white px-6 py-7">
              <span className="text-[10px] font-mono text-gray-300 mb-2 block">{f.label}</span>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-xs leading-relaxed text-gray-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Multi-Quarter Pointer Sheet ─────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-3">Multi-Quarter Tracking</p>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Your automated earnings pointer sheet.</h2>
          <p className="text-sm text-gray-500 mb-10 max-w-xl">Every dimension tracked across quarters — financials, growth outlook, margins, cost control, capex, customers, macro, themes, guidance, product launches.</p>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {[
              "Financials", "Growth Outlook", "Margins", "Cost Control",
              "Capex & Capacity", "Customers & Market", "Macro & News",
              "Recurring Themes", "Guidance Tracker", "Product Updates",
            ].map((tab) => (
              <div key={tab} className="rounded border border-gray-200 bg-white px-3 py-2.5 text-center shadow-sm">
                <span className="text-[11px] font-medium text-gray-600">{tab}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coverage stats ──────────────────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl font-bold text-gray-900">200</p>
              <p className="text-[11px] text-gray-400 mt-1 uppercase tracking-wider">Nifty Companies</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">500</p>
              <p className="text-[11px] text-gray-400 mt-1 uppercase tracking-wider">Concall Videos</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">17</p>
              <p className="text-[11px] text-gray-400 mt-1 uppercase tracking-wider">Sectors Tracked</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">60s</p>
              <p className="text-[11px] text-gray-400 mt-1 uppercase tracking-wider">Per Analysis</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Positioning + CTA ───────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Concall intelligence in 60 seconds.
          </h2>
          <p className="text-base text-gray-600 mb-4 font-medium">
            10x more comprehensive than anything in the market. Rich, detailed, actionable.
          </p>
          <p className="text-sm text-gray-500 mb-10 max-w-md mx-auto">
            Built for portfolio managers, equity research desks, wealth management firms, and family offices who need to track management behavior — not just numbers.
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
            <Link href="/privacy" className="hover:text-gray-700 transition">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-700 transition">Terms</Link>
            <a href="mailto:support@demandion.ai" className="hover:text-gray-700 transition">support@demandion.ai</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
