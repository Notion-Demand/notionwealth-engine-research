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
    <div className="min-h-screen bg-[#0a0a0f] text-white">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight text-white">
          Quantalyze
        </span>
        <Link
          href="/login"
          className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pb-24 pt-24 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1.5 text-xs font-medium text-sky-400">
          Built for Nifty 50 research teams
        </div>

        <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-white md:text-6xl">
          Earnings intelligence
          <br />
          <span className="text-sky-400">in 60 seconds.</span>
        </h1>

        <p className="mx-auto mb-10 max-w-xl text-lg text-white/50 leading-relaxed">
          AI analysts read every earnings call transcript, detect language
          shifts quarter-over-quarter, score executive evasiveness, and surface
          what changed — so your team doesn&apos;t have to.
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

      {/* ── Feature grid ────────────────────────────────────────────────── */}
      <section className="border-t border-white/5 bg-white/[0.02]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-white/5 px-6 md:grid-cols-3 md:divide-x md:divide-y-0">
          {[
            {
              icon: "⚡",
              title: "Multi-agent analysis",
              body: "Four specialist AI agents — Capital, Revenue, Margins, Macro — analyse every call in parallel. Results in under a minute.",
            },
            {
              icon: "📊",
              title: "Quarter-over-quarter signals",
              body: "Every metric is compared against the prior quarter. Language shifts are classified Positive, Negative, or Noise with a scored signal.",
            },
            {
              icon: "🎭",
              title: "Executive evasiveness score",
              body: "Detects when management deflects analyst questions, pivots to talking points, or uses excessive hedging language.",
            },
            {
              icon: "✅",
              title: "Market validation",
              body: "Signals are cross-checked against the stock's actual quarterly return to flag where management narrative diverges from market reality.",
            },
            {
              icon: "📬",
              title: "Send to clients via Gmail",
              body: "One click sends a branded, formatted report directly from your Gmail to any client — no copy-pasting required.",
            },
            {
              icon: "💬",
              title: "Slack slash command",
              body: "Type /earnings BHARTI in any Slack channel and the full analysis posts directly — results cached, so repeat queries are instant.",
            },
          ].map((f) => (
            <div key={f.title} className="px-8 py-10">
              <div className="mb-3 text-2xl">{f.icon}</div>
              <h3 className="mb-2 text-sm font-semibold text-white">{f.title}</h3>
              <p className="text-sm leading-relaxed text-white/45">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Social proof / positioning ───────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-white/30">
          Designed for
        </p>
        <div className="flex flex-wrap justify-center gap-x-10 gap-y-4 text-sm font-medium text-white/40">
          {[
            "Wealth management firms",
            "Equity research desks",
            "Portfolio management teams",
            "Independent analysts",
          ].map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </section>

      {/* ── CTA banner ──────────────────────────────────────────────────── */}
      <section className="border-t border-white/5">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white">
            Stop reading transcripts. Start reading signals.
          </h2>
          <p className="mb-8 text-white/45">
            Every Nifty 50 company, every quarter, in under a minute.
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
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-xs text-white/30 sm:flex-row">
          <span>© {new Date().getFullYear()} Quantalyze. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white/60 transition">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white/60 transition">Terms of Service</Link>
            <a href="mailto:hello@quantalyze.me" className="hover:text-white/60 transition">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
