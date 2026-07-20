# Why Quantalyze Value-Prop Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, unauthenticated `/why-quantalyze` page presenting the ten value-prop themes from the `canva/` marketing campaign as native website copy, linked from the landing page's header nav and its "Proprietary Signals" section.

**Architecture:** One new self-contained Server Component page (`app/why-quantalyze/page.tsx`), light theme matching `app/page.tsx` (not the dark secondary-page theme used by `/privacy`, `/terms`, `/developers`), reusing `app/page.tsx`'s existing header, "Value Propositions" dot-bullet list pattern, CTA pattern, and footer markup verbatim — no new visual patterns invented. Two small edits to `app/page.tsx`: a new header-nav link and a new one-line link inside the existing "Proprietary Signals" section.

**Tech Stack:** Next.js 14 App Router, React Server Components, TypeScript, Tailwind CSS. No new npm dependencies.

## Global Constraints

- No raw Canva PDFs embedded or hosted — all content is rewritten as native page copy (per spec, per user's explicit choice).
- Single page, all ten themes in one place — no per-theme sub-pages (per user's explicit choice).
- Light theme matching `app/page.tsx` (`bg-white text-gray-900`) — this is core marketing content in the landing page's register, not a utility/legal page (per user's explicit choice).
- No changes to `app/developers/page.tsx`, `middleware.ts`, or any API route — this is a landing-page-adjacent marketing page only.
- No changes to `app/page.tsx` beyond: one new header-nav link, and one new link inside the existing "Proprietary Signals" section.
- Every headline/paragraph in "The Ten Questions" section must be the exact wording from the approved spec (`docs/superpowers/specs/2026-07-20-why-quantalyze-page-design.md`) — this wording was already reviewed and approved, do not paraphrase or invent new claims.
- No test framework exists in this repo (no Jest/Vitest, no `*.test.*` files, no `test` script in `package.json`). Verification is `npm run build` (TypeScript + ESLint) plus manual dev-server checks.
- Code must follow the single self-contained file convention already used by `app/page.tsx` and `app/developers/page.tsx` — no extracted sub-components for this page.

---

### Task 1: Page shell — metadata, header, hero

**Files:**
- Create: `app/why-quantalyze/page.tsx`

**Interfaces:**
- Produces: the page's root `<div className="min-h-screen bg-white text-gray-900">` wrapper and `<main>`-less section structure that Tasks 2-3 append `<section>` elements into, directly after the hero section's closing `</section>` tag.

- [ ] **Step 1: Create the file with metadata, header, and hero**

```tsx
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
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors. `/why-quantalyze` appears in the route list in the build output.

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev`, open `http://localhost:3000/why-quantalyze`.
Expected: light page renders with "Quantalyze" wordmark (linking to `/`) + "Book a Demo"/"Sign in" in the header, the "Ten Questions. Every Call. One Unfair Edge." eyebrow, the h1, and the intro paragraph, matching the landing page's visual style (white background, dark text).

- [ ] **Step 4: Commit**

```bash
git add app/why-quantalyze/page.tsx
git commit -m "feat: add Why Quantalyze page shell with hero"
```

---

### Task 2: The Ten Questions section

**Files:**
- Modify: `app/why-quantalyze/page.tsx` (insert a new `<section>` immediately after the hero section's closing `</section>` tag, before the page root's closing `</div>`)

**Interfaces:**
- Consumes: none from Task 1 beyond the insertion point.
- Produces: nothing new consumed by Task 3 — Task 3 only needs the insertion point (after this section's closing `</section>`).

- [ ] **Step 1: Insert the Ten Questions section**

Insert directly after the hero section's closing `</section>` tag (before the page root's closing `</div>`):

```tsx
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
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors.

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev`, open `http://localhost:3000/why-quantalyze`.
Expected: "The Ten Questions" section renders below the hero with exactly ten dot-bulleted items, each with a bold headline and a gray detail paragraph, in the order given above.

- [ ] **Step 4: Cross-check wording against the approved spec**

Read `docs/superpowers/specs/2026-07-20-why-quantalyze-page-design.md`'s "The Ten Questions" list and confirm all ten headlines and detail paragraphs in `app/why-quantalyze/page.tsx` match that spec's wording exactly (word-for-word) — this wording was already reviewed and approved, so any mismatch here is a transcription error to fix, not a wording choice to make.

- [ ] **Step 5: Commit**

```bash
git add app/why-quantalyze/page.tsx
git commit -m "feat: add Ten Questions section to Why Quantalyze page"
```

---

### Task 3: CTA, footer, and page completion

**Files:**
- Modify: `app/why-quantalyze/page.tsx` (insert a new `<section>` immediately after the Ten Questions section's closing `</section>` tag, then a `<footer>` immediately after that, both before the page root's closing `</div>`)

**Interfaces:**
- Consumes: none from Tasks 1-2 beyond the insertion point.

- [ ] **Step 1: Insert the CTA section and footer**

Insert directly after the Ten Questions section's closing `</section>` tag (before the page root's closing `</div>`):

```tsx
      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            See how this looks on your own portfolio.
          </h2>
          <p className="text-sm text-gray-500 mb-8 max-w-md mx-auto">
            Book a demo and we&apos;ll walk through a live earnings call using your own coverage list.
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
```

Note: a footer is not explicitly listed in the spec's "Page Sections," but every other page in this codebase (`app/page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/developers/page.tsx`) has one, and this page would otherwise dead-end with no path to the legal pages. This reuses the landing page's exact footer markup verbatim — it is not new content or new scope, just the site's existing structural convention.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors.

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev`, open `http://localhost:3000/why-quantalyze`.
Expected: page now ends with the "See how this looks on your own portfolio." CTA section (with a working Calendly link opening in a new tab) followed by the same footer used on the landing page (API Docs / Privacy / Terms / support email links, all functional).

- [ ] **Step 4: Commit**

```bash
git add app/why-quantalyze/page.tsx
git commit -m "feat: add CTA and footer to Why Quantalyze page"
```

---

### Task 4: Landing page integration — header nav link and Proprietary Signals link

**Files:**
- Modify: `app/page.tsx:14-34` (header nav)
- Modify: `app/page.tsx:196-216` (Proprietary Signals section)

**Interfaces:**
- Consumes: the `/why-quantalyze` route created in Tasks 1-3.

- [ ] **Step 1: Add the "Why Quantalyze" header nav link**

In `app/page.tsx`, replace the header block:

```tsx
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
```

with:

```tsx
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 border-b border-gray-100">
        <span className="text-base font-semibold tracking-[0.15em] uppercase text-gray-900">
          Quantalyze
        </span>
        <div className="flex items-center gap-4">
          <Link
            href="/why-quantalyze"
            className="text-xs font-medium text-gray-500 transition hover:text-gray-900"
          >
            Why Quantalyze
          </Link>
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
```

- [ ] **Step 2: Add the "See how these work" link to the Proprietary Signals section**

In `app/page.tsx`, replace the Proprietary Signals block:

```tsx
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
```

with:

```tsx
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
          <Link
            href="/why-quantalyze"
            className="mt-6 inline-block text-sm font-medium text-gray-900 transition hover:text-gray-600"
          >
            See how these work &rarr;
          </Link>
        </div>
      </section>
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build completes with no TypeScript or lint errors.

- [ ] **Step 4: Manually verify both links**

Run: `npm run dev`, open `http://localhost:3000/`.
Expected: header now shows "Why Quantalyze" before "Book a Demo," and clicking it navigates to `/why-quantalyze`. Scrolling to the "Proprietary Signals" section shows a new "See how these work →" link below the six-tag grid, and clicking it also navigates to `/why-quantalyze`.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: link to Why Quantalyze page from landing page nav and Proprietary Signals section"
```

---

## Self-Review

**Spec coverage:** Architecture (single self-contained file, light theme, Task 1) — covered. Navigation (header link + Proprietary Signals link, Task 4) — covered. Content grounding (exact spec wording, Task 2 Step 4 cross-check) — covered. Hero, Ten Questions, CTA (Tasks 1-3) — covered. Testing (build + manual + wording cross-check) — covered in each task's verification steps.

**Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code; full JSX repeated in each task rather than "similar to Task N" references.

**Type consistency:** No shared function signatures between tasks in this plan (each task only adds JSX to the same file) — no drift risk to check beyond the insertion-point continuity, which each task states explicitly (append after the previous task's closing tag, before the page root's closing `</div>`).
