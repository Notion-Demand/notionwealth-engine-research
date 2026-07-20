import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Why Quantalyze — Ten Questions Every Earnings Call Answers",
  description:
    "The ten signals Quantalyze tracks on every earnings call: guidance credibility, narrative shifts, evasive answers, red flags, and more.",
};

export default function WhyQuantalyzePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 border-b border-gray-100">
        <Link href="/" className="text-base font-semibold tracking-[0.15em] uppercase text-gray-900">
          Quantalyze
        </Link>
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
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-16 text-center">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400">
          Ten Questions. Every Call. One Unfair Edge.
        </p>
        <h1 className="mb-6 text-3xl font-bold leading-[1.2] tracking-tight text-gray-900 md:text-[2.5rem]">
          Earnings calls say more than the headline numbers.
        </h1>
        <p className="mx-auto max-w-xl text-base text-gray-500 leading-relaxed">
          Most of what matters on a call — hedging, silence, tone shifts, risk language that
          softens or hardens — never makes it into a summary, because nobody tracks it
          systematically across every call. That gap is where Quantalyze&apos;s edge comes from.
          Here are the ten questions it answers on every single transcript.
        </p>
      </section>

    </div>
  );
}
