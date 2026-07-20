# "Why Quantalyze" Value-Prop Page Design

## Context

The `canva/` folder contains an 11-script video/carousel caption collection (`Demandion_Quantalyze_Video_Scripts.pdf`) plus ten matching Canva carousel presentation PDFs, all built around a single marketing campaign: "Ten questions. Ten weeks. One unfair edge." Each script/deck pitches one specific Quantalyze capability as "Question N of 10 that Quantalyze answers on every call." No real company names appear anywhere in this material — all examples are generic/illustrative, so there is no compliance concern in reusing the substance on the public site.

The landing page (`app/page.tsx`) already teases some of these same ideas as single words in its "Proprietary Signals" grid (Guidance Credibility, Executive Evasiveness, Promoter Pledge Activity, Recurring Themes, Management Confidence, Sector Narrative Shifts) but never explains them. This page is the deep-dive destination for that teaser — turning single words into the actual problem/solution narrative from the campaign material.

## Goal

A page that lets a prospective customer get acquainted with what Quantalyze actually does and why it matters, by presenting the campaign's ten value-prop themes as native website content — not raw PDFs.

## Non-Goals

- No embedding or hosting of the raw Canva PDF files — all content is rewritten as native page copy.
- No per-theme sub-pages — this is a single page with all ten themes, per user's explicit choice (fastest to scan, one URL to link and maintain).
- No new API endpoints, no changes to the Public API docs page or any existing route.
- No changes to the landing page's structure beyond: one new header-nav link, and one new "Learn more" link from the existing "Proprietary Signals" section.

## Architecture

**New page**: `app/why-quantalyze/page.tsx` — a public, unauthenticated Next.js page, light theme matching `app/page.tsx` (not the dark secondary-page theme used by `/privacy`, `/terms`, `/developers` — this is core marketing content in the landing page's register, not a utility/legal page). Written as a single self-contained file, following the same convention as `app/page.tsx` and `app/developers/page.tsx`.

**Navigation**:
- One new link, "Why Quantalyze," added to `app/page.tsx`'s header nav, between the "Quantalyze" wordmark and the "Book a Demo" button (before "Sign in").
- The existing "Proprietary Signals" section in `app/page.tsx` (the six-tag grid) gets a one-line "See how these work →" link pointing to `/why-quantalyze`, since that section is this new page's natural teaser.
- The new page's own header reuses the same wordmark/Book a Demo/Sign in pattern as `app/page.tsx`'s header, for visual continuity when navigating between the two.

**Content grounding**: every headline and paragraph is a rewritten distillation of the real campaign material (`Demandion_Quantalyze_Video_Scripts.pdf` and the matching Canva decks), not fabricated claims. Specific figures used (e.g. "roughly 70% research time reduction") are carried over verbatim from the source material, not invented for this page.

## Page Sections

1. **Hero** — Short, direct framing establishing the page's thesis: earnings calls contain more signal than headline numbers, most of it is missed because nobody tracks it systematically across every call, and that gap is where Quantalyze's edge comes from. Closes with the "Ten questions. Every call. One unfair edge." framing from the source campaign.

2. **The Ten Questions** — a vertical list (reusing `app/page.tsx`'s existing "Value Propositions" section pattern: a bullet dot, a bold one-line headline, and a gray detail paragraph beneath it — no new component needed). Ten items, in the following narrative order (reordered from original posting order into a logical arc: track record → change detection → omission detection → early warning → risk tracking → attribution → inflection detection → live-call reading → preparation → the meta-capability that ties it together):

   1. **Guidance credibility, scored — not eyeballed.** Promises get made on every call and quietly forgotten by the next. Quantalyze tracks whether a CEO's guidance has actually held up over the last four quarters and turns it into a comparable credibility score — so you can rank management quality across your entire portfolio before deciding where to add capital.
   2. **What changed since last quarter — not just what was said.** Comparing transcripts quarter over quarter by hand takes hours, and subtle tone shifts still slip through. Quantalyze surfaces new themes, dropped themes, guidance changes, and tone shifts automatically — cutting research time by roughly 70% without skipping the details that matter.
   3. **The silence is the signal.** Topics that quietly disappear between quarters are nearly impossible to catch by reading transcripts one at a time. Quantalyze tracks which subjects stopped coming up, which analyst questions got sidestepped, and how discussion frequency is trending — because what management stops talking about is often more informative than what they do say.
   4. **Red flags, before they hit the P&L.** By the time deterioration shows up in reported numbers, the exit window has usually already closed. Quantalyze tracks rising concern frequency, margin-pressure language, and demand-weakness commentary quarter over quarter — surfacing early warning signs while there's still time to act on them.
   5. **Risk disclosure, tracked like everything else.** What management chooses to disclose — and how prominently — changes quarter to quarter, and that shift often says more than the risk section of an annual report. Quantalyze tracks new risks as they're introduced, risks that quietly get dropped, and language that softens on a worsening issue, compared against peers.
   6. **One company's miss — or the whole sector's?** When management blames macro conditions, the only way to know if that's true is to check what peers are saying. Quantalyze cross-references transcripts across the sector: same themes, same language, same timing means a sector headwind; an isolated pattern means a company-specific problem — and knowing which one you're holding changes what you do next.
   7. **Finding the beat before the market does.** Improving guidance framing, rising management confidence, and positive narrative shifts tend to show up in language before they show up in results — but almost nobody tracks that systematically across a whole portfolio. Quantalyze detects those inflections call over call, so you can get in ahead of consensus instead of after the beat is already priced in.
   8. **Confidence in the numbers means nothing with evasion in the answers.** Hesitation, tone shifts, and deflection on a live call carry information that prepared remarks alone don't. Quantalyze tracks hedging language, evasive answers, and reduced detail on sensitive line items quarter over quarter — because what management refuses to answer is often as informative as what they do.
   9. **Walk in knowing what to listen for.** Reacting live on a call means losing the first ten minutes of signal while prepared analysts are already adjusting positions. Quantalyze generates a pre-earnings brief — trending topics, risks to watch, questions management has been dodging, what peers already said — so the call becomes a confirmation exercise, not a cold read.
   10. **The question every investor forgets to ask.** The most expensive blind spots aren't the obvious ones — they're the things you didn't know to look for. Quantalyze runs all nine of the above on every single call, systematically, so coverage doesn't depend on which questions you happened to remember to ask that quarter.

3. **CTA** — closing section linking to the existing Calendly link (`https://calendly.com/quantalyze/say-hi`), same copy pattern as the landing page's own CTA section ("Book a Demo").

## Testing

Since this is a static content page with no new backend logic: verify the page builds and renders (`npm run build` / dev server), verify the new header-nav link and the "Proprietary Signals" section's new link both navigate correctly, and manually re-read the ten items against the source campaign material (`canva/Demandion_Quantalyze_Video_Scripts.pdf` and the matching presentation PDFs) to confirm no claim was invented or overstated beyond what the source material actually says.
