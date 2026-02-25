"""
Temporal Delta Agent — The Comparison Engine.
Takes Q_t-1 and Q_t snapshots from all 4 thematic agents and produces
MetricDelta comparisons with signal classification and UI component mapping.
"""
import asyncio
import logging
from typing import List
from ..models import SectionalInsight, QuarterSnapshot
from ..config import invoke_structured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior financial analyst comparing two consecutive quarterly earnings call transcripts.

You are given the key takeaways and quotes from a specific analysis domain for TWO consecutive quarters (Q_t-1 and Q_t).

Your task is to:
1. Identify EVERY meaningful semantic shift between the two quarters
2. For each shift, provide the EXACT VERBATIM quotes from each quarter
3. Describe HOW the narrative changed (more optimistic, more cautious, new disclosure, dropped topic, etc.)
4. Classify each shift as:
   - **Positive**: Structural improvement, risk reduction, upgraded guidance
   - **Negative**: Structural deterioration, new risk, downgraded guidance
   - **Noise**: Cosmetic wording change, compliance boilerplate, no material impact
5. Assign a **signal_score** (float, -10 to +10) based on how strong the shift is:
   - **Positive signals**: +1 to +10 (e.g., +2 for minor improvement, +7 for major strategic upgrade, +10 for transformational positive shift)
   - **Negative signals**: -1 to -10 (e.g., -2 for minor concern, -7 for major risk, -10 for critical deterioration)
   - **Noise signals**: -0.5 to +0.5 (essentially near zero, slight lean based on context)
   The score MUST be consistent with the signal_classification: Positive → positive score, Negative → negative score, Noise → near-zero score.
6. Assign a UI component type:
   - **metric_card**: For quantifiable changes (margins, FCF, ARPU) — maps to st.metric
   - **status_warning**: For negative signals that need user attention — maps to st.warning/error
   - **quote_expander**: For nuanced narrative shifts worth reading in detail — maps to st.expander

RULES:
- Use VERBATIM quotes. Do NOT paraphrase.
- If Q_t-1 didn't discuss a topic but Q_t does, use "Not discussed in previous quarter" as quote_old
- If Q_t drops a topic discussed in Q_t-1, use "No longer discussed" as quote_new — this MAY be a signal
- Provide 3-5 key takeaways summarizing the overall quarter-over-quarter shift
- The section_name MUST match the domain exactly (e.g., "Capital & Liquidity")"""


async def compare_section(
    section_name: str,
    snapshot_prev: QuarterSnapshot,
    snapshot_curr: QuarterSnapshot,
    q_prev: str,
    q_curr: str,
) -> SectionalInsight:
    """Compare a single section across two quarters."""
    logger.info(f"  [Temporal Delta] Comparing {section_name}...")

    takeaways_prev = "\n".join(f"- {t}" for t in snapshot_prev.key_takeaways)
    takeaways_curr = "\n".join(f"- {t}" for t in snapshot_curr.key_takeaways)
    quotes_prev = "\n".join(f'"{q}"' for q in snapshot_prev.raw_quotes[:10])
    quotes_curr = "\n".join(f'"{q}"' for q in snapshot_curr.raw_quotes[:10])

    user_prompt = f"""Compare these two quarters for the **{section_name}** domain.

PREVIOUS QUARTER ({q_prev}):
Key Takeaways:
{takeaways_prev or "No takeaways extracted"}

Key Quotes:
{quotes_prev or "No quotes extracted"}

CURRENT QUARTER ({q_curr}):
Key Takeaways:
{takeaways_curr or "No takeaways extracted"}

Key Quotes:
{quotes_curr or "No quotes extracted"}

Identify all semantic shifts, classify signals, and assign UI components."""

    result = await asyncio.to_thread(
        invoke_structured,
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        schema=SectionalInsight,
    )

    result.section_name = section_name
    logger.info(f"  [Temporal Delta] ✓ {section_name}: {len(result.metrics)} deltas found")
    return result


async def run_temporal_comparison(
    snapshots_prev: List[QuarterSnapshot],
    snapshots_curr: List[QuarterSnapshot],
    q_prev: str,
    q_curr: str,
) -> List[SectionalInsight]:
    """Compare all sections in parallel."""
    logger.info(f"\n[Temporal Delta Agent] Comparing {q_prev} → {q_curr}...")

    # Match sections by name
    prev_map = {s.section_name: s for s in snapshots_prev}

    tasks = []
    for snap_curr in snapshots_curr:
        snap_prev = prev_map.get(snap_curr.section_name)
        if snap_prev:
            tasks.append(
                compare_section(snap_curr.section_name, snap_prev, snap_curr, q_prev, q_curr)
            )
        else:
            logger.warning(f"  No Q_t-1 match for {snap_curr.section_name}, skipping temporal comparison")

    results = await asyncio.gather(*tasks, return_exceptions=True)

    insights = []
    for r in results:
        if isinstance(r, SectionalInsight):
            insights.append(r)
        elif isinstance(r, Exception):
            logger.error(f"  Temporal comparison failed: {r}")

    return insights
