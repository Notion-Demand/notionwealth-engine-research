"""
Validation Agent — Quality Gate.
Cross-checks the temporal delta output against raw transcripts to catch
hallucinated quotes, fabricated numbers, and signal-score inconsistencies.
Runs as Step 4 in the pipeline, before UI rendering.
"""
import asyncio
import re
import logging
from typing import List, Tuple
from difflib import SequenceMatcher
from pydantic import BaseModel, Field

from ..models import SectionalInsight, MetricDelta
from ..config import invoke_structured

logger = logging.getLogger(__name__)


class MetricValidation(BaseModel):
    """Validation result for a single metric."""
    subtopic: str = Field(description="The subtopic being validated")
    status: str = Field(description="'verified', 'flagged', or 'removed'")
    reason: str = Field(description="Explanation — empty if verified, otherwise what's wrong")
    corrected_quote_old: str = Field(default="", description="Corrected quote from Q_t-1 if original was inaccurate. Empty if no correction needed.")
    corrected_quote_new: str = Field(default="", description="Corrected quote from Q_t if original was inaccurate. Empty if no correction needed.")


class ValidationReport(BaseModel):
    """Full validation report for a section."""
    section_name: str
    results: List[MetricValidation]


SYSTEM_PROMPT = """You are a strict financial data auditor. Your role is to validate the accuracy of AI-generated earnings analysis by cross-checking against the ORIGINAL transcript text.

For EACH metric provided, verify:

1. **Quote Accuracy**: Do the quotes (quote_old, quote_new) actually appear in the transcripts? 
   - They must be close matches (minor formatting differences OK)
   - If a quote is fabricated (not found anywhere in the text), mark as FLAGGED or REMOVED
   - If you find the actual correct quote that was paraphrased, provide it as corrected_quote

2. **Factual Accuracy**: Any numbers, percentages, revenue figures, margins, growth rates mentioned in quotes or language_shift MUST match the transcript exactly.
   - If the transcript says "revenue grew 18%" but the metric says "revenue grew 20%", that is FLAGGED
   - If figures are completely fabricated with no source in the transcript, mark as REMOVED

3. **Signal-Score Consistency**: 
   - Positive signal MUST have positive score (>0)
   - Negative signal MUST have negative score (<0)
   - Noise signal should be near zero (-0.5 to +0.5)
   - Mismatch = FLAGGED

4. **Language Shift Accuracy**: Does the described language_shift accurately reflect what changed between the quotes?
   - If the shift is exaggerated or misrepresented, mark as FLAGGED

Classification:
- **verified**: Quote exists, facts are accurate, signal/score consistent
- **flagged**: Minor issues (slight paraphrase, small number discrepancy) — provide correction
- **removed**: Major hallucination (fabricated quote, made-up numbers, complete misrepresentation)

Be STRICT about numbers. Financial figures must be exact."""


async def validate_section(
    insight: SectionalInsight,
    text_prev: str,
    text_curr: str,
    q_prev: str,
    q_curr: str,
) -> SectionalInsight:
    """Validate a single section's metrics against raw transcripts."""
    if not insight.metrics:
        return insight

    logger.info(f"  [Validation] Checking {insight.section_name} ({len(insight.metrics)} metrics)...")

    # Build the validation prompt with all metrics and transcript excerpts
    metrics_text = ""
    for i, m in enumerate(insight.metrics):
        metrics_text += f"""
Metric {i+1}: {m.subtopic}
  quote_old: "{m.quote_old}"
  quote_new: "{m.quote_new}"
  language_shift: "{m.language_shift}"
  signal: {m.signal_classification}, score: {m.signal_score}
"""

    user_prompt = f"""Validate these {len(insight.metrics)} metrics from the **{insight.section_name}** section.

METRICS TO VALIDATE:
{metrics_text}

PREVIOUS QUARTER TRANSCRIPT ({q_prev}):
{text_prev[:40000]}

CURRENT QUARTER TRANSCRIPT ({q_curr}):
{text_curr[:40000]}

For each metric, verify quotes exist in the transcripts, check all numbers/percentages are accurate, and confirm signal-score consistency."""

    try:
        report = await asyncio.to_thread(
            invoke_structured,
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            schema=ValidationReport,
        )

        # Apply validation results to the metrics
        result_map = {r.subtopic: r for r in report.results}
        validated_metrics = []

        for metric in insight.metrics:
            val = result_map.get(metric.subtopic)
            if val:
                metric.validation_status = val.status
                metric.validation_note = val.reason

                # Apply corrected quotes if provided
                if val.corrected_quote_old:
                    metric.quote_old = val.corrected_quote_old
                if val.corrected_quote_new:
                    metric.quote_new = val.corrected_quote_new

                if val.status == "removed":
                    logger.warning(f"    ✗ REMOVED: {metric.subtopic} — {val.reason}")
                elif val.status == "flagged":
                    logger.warning(f"    ⚠ FLAGGED: {metric.subtopic} — {val.reason}")
                else:
                    logger.info(f"    ✓ Verified: {metric.subtopic}")
            
            # Keep all metrics (even removed) — UI will handle display
            validated_metrics.append(metric)

        insight.metrics = validated_metrics

    except Exception as e:
        logger.error(f"  [Validation] Failed for {insight.section_name}: {e}")
        # On failure, do local checks only
        _local_consistency_check(insight)

    return insight


def _local_consistency_check(insight: SectionalInsight) -> None:
    """Fast local checks (no LLM) as fallback if validation agent fails."""
    for m in insight.metrics:
        # Signal-score consistency
        if m.signal_classification == "Positive" and m.signal_score < 0:
            m.validation_status = "flagged"
            m.validation_note = f"Signal is Positive but score is {m.signal_score}"
        elif m.signal_classification == "Negative" and m.signal_score > 0:
            m.validation_status = "flagged"
            m.validation_note = f"Signal is Negative but score is {m.signal_score}"


async def validate_insights(
    insights: List[SectionalInsight],
    text_prev: str,
    text_curr: str,
    q_prev: str,
    q_curr: str,
) -> Tuple[List[SectionalInsight], float, int]:
    """
    Validate all sections in parallel.
    
    Returns:
        (validated_insights, validation_score, flagged_count)
    """
    logger.info(f"\n[Validation Agent] Auditing {sum(len(i.metrics) for i in insights)} metrics...")

    # Run validation for all sections in parallel
    tasks = [
        validate_section(insight, text_prev, text_curr, q_prev, q_curr)
        for insight in insights
    ]
    validated = await asyncio.gather(*tasks, return_exceptions=True)

    result_insights = []
    for v in validated:
        if isinstance(v, SectionalInsight):
            result_insights.append(v)
        elif isinstance(v, Exception):
            logger.error(f"  Validation error: {v}")

    # Compute validation stats
    total = 0
    verified = 0
    flagged = 0
    for insight in result_insights:
        for m in insight.metrics:
            total += 1
            if m.validation_status == "verified":
                verified += 1
            elif m.validation_status in ("flagged", "removed"):
                flagged += 1

    validation_score = (verified / total * 100) if total > 0 else 100.0
    logger.info(f"  Validation Score: {validation_score:.1f}% ({verified}/{total} verified, {flagged} flagged/removed)")

    return result_insights, round(validation_score, 1), flagged
