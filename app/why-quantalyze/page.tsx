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

      {/* ── The Ten Questions ──────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-400 mb-8">The Ten Questions</p>
          <div className="space-y-8">
            {[
              {
                bold: "Guidance credibility, scored — not eyeballed.",
                detail: "Promises get made on every call and quietly forgotten by the next. Quantalyze tracks whether a CEO's guidance has actually held up over the last four quarters and turns it into a comparable credibility score — so you can rank management quality across your entire portfolio before deciding where to add capital.",
              },
              {
                bold: "What changed since last quarter — not just what was said.",
                detail: "Comparing transcripts quarter over quarter by hand takes hours, and subtle tone shifts still slip through. Quantalyze surfaces new themes, dropped themes, guidance changes, and tone shifts automatically — cutting research time by roughly 70% without skipping the details that matter.",
              },
              {
                bold: "The silence is the signal.",
                detail: "Topics that quietly disappear between quarters are nearly impossible to catch by reading transcripts one at a time. Quantalyze tracks which subjects stopped coming up, which analyst questions got sidestepped, and how discussion frequency is trending — because what management stops talking about is often more informative than what they do say.",
              },
              {
                bold: "Red flags, before they hit the P&L.",
                detail: "By the time deterioration shows up in reported numbers, the exit window has usually already closed. Quantalyze tracks rising concern frequency, margin-pressure language, and demand-weakness commentary quarter over quarter — surfacing early warning signs while there's still time to act on them.",
              },
              {
                bold: "Risk disclosure, tracked like everything else.",
                detail: "What management chooses to disclose — and how prominently — changes quarter to quarter, and that shift often says more than the risk section of an annual report. Quantalyze tracks new risks as they're introduced, risks that quietly get dropped, and language that softens on a worsening issue, compared against peers.",
              },
              {
                bold: "One company's miss — or the whole sector's?",
                detail: "When management blames macro conditions, the only way to know if that's true is to check what peers are saying. Quantalyze cross-references transcripts across the sector: same themes, same language, same timing means a sector headwind; an isolated pattern means a company-specific problem — and knowing which one you're holding changes what you do next.",
              },
              {
                bold: "Finding the beat before the market does.",
                detail: "Improving guidance framing, rising management confidence, and positive narrative shifts tend to show up in language before they show up in results — but almost nobody tracks that systematically across a whole portfolio. Quantalyze detects those inflections call over call, so you can get in ahead of consensus instead of after the beat is already priced in.",
              },
              {
                bold: "Confidence in the numbers means nothing with evasion in the answers.",
                detail: "Hesitation, tone shifts, and deflection on a live call carry information that prepared remarks alone don't. Quantalyze tracks hedging language, evasive answers, and reduced detail on sensitive line items quarter over quarter — because what management refuses to answer is often as informative as what they do.",
              },
              {
                bold: "Walk in knowing what to listen for.",
                detail: "Reacting live on a call means losing the first ten minutes of signal while prepared analysts are already adjusting positions. Quantalyze generates a pre-earnings brief — trending topics, risks to watch, questions management has been dodging, what peers already said — so the call becomes a confirmation exercise, not a cold read.",
              },
              {
                bold: "The question every investor forgets to ask.",
                detail: "The most expensive blind spots aren't the obvious ones — they're the things you didn't know to look for. Quantalyze runs all nine of the above on every single call, systematically, so coverage doesn't depend on which questions you happened to remember to ask that quarter.",
              },
            ].map((v) => (
              <div key={v.bold} className="flex gap-4 items-start">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-gray-900 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">{v.bold}</p>
                  <p className="text-sm text-gray-500 mt-1">{v.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
