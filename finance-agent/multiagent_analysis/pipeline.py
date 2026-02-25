"""
Multi-Agent Pipeline Orchestrator.
Coordinates 4 thematic agents + temporal delta agent with async parallel execution.
"""
import asyncio
import json
import time
import logging
import argparse
from typing import List, Dict
from pathlib import Path
from pydantic import BaseModel, Field

from .models import DashboardPayload, QuarterSnapshot, SectionalInsight
from .parser import load_transcript_pair
from .agents import capital_liquidity, revenue_growth, operational_margin, macro_risk
from .agents.temporal_delta import run_temporal_comparison
from .config import invoke_structured

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger(__name__)


class EvasivenessScore(BaseModel):
    """Score for executive evasiveness in Q&A."""
    score: float = Field(ge=0, le=10, description="0=very direct, 10=extremely evasive")
    reasoning: str = Field(description="Brief explanation of the score")


async def extract_quarter(transcript: str, company: str, quarter: str) -> List[QuarterSnapshot]:
    """Run all 4 thematic agents in parallel on a single quarter."""
    logger.info(f"\n{'='*60}")
    logger.info(f"Running 4 agents in parallel on {company} {quarter}...")
    logger.info(f"{'='*60}")

    results = await asyncio.gather(
        capital_liquidity.analyze(transcript, company, quarter),
        revenue_growth.analyze(transcript, company, quarter),
        operational_margin.analyze(transcript, company, quarter),
        macro_risk.analyze(transcript, company, quarter),
        return_exceptions=True,
    )

    snapshots = []
    for r in results:
        if isinstance(r, QuarterSnapshot):
            snapshots.append(r)
        elif isinstance(r, Exception):
            logger.error(f"  Agent failed: {r}")

    logger.info(f"  ✓ {len(snapshots)}/4 agents completed successfully")
    return snapshots


async def compute_evasiveness(transcript: str, company: str, quarter: str) -> float:
    """Score executive evasiveness from Q&A section."""
    system_prompt = """You are analyzing executive Q&A behavior in an earnings call.

Score the executives' evasiveness from 0 to 10:
- 0-2: Very direct, clear answers with specifics
- 3-4: Generally responsive with occasional hedging
- 5-6: Moderate deflection, uses generic language
- 7-8: Frequently avoids direct answers, pivots to talking points
- 9-10: Actively dodges questions, non-answers, contradicts data

Focus on the Q&A section. Look for: redirecting questions, excessive caveats,
answering a different question than asked, vague forward-looking statements."""

    user_prompt = f"Rate the executive evasiveness in this {company} {quarter} earnings call:\n\n{transcript[-30000:]}"

    try:
        result = await asyncio.to_thread(
            invoke_structured,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            schema=EvasivenessScore,
        )
        logger.info(f"  Executive Evasiveness Score: {result.score}/10")
        return result.score
    except Exception as e:
        logger.warning(f"  Evasiveness scoring failed: {e}, defaulting to 5.0")
        return 5.0


def compute_overall_signal(insights: List[SectionalInsight]) -> tuple:
    """Aggregate signal scores across all agents. Returns (overall_score, signal_label)."""
    all_scores = []
    for insight in insights:
        for m in insight.metrics:
            all_scores.append(m.signal_score)

    if not all_scores:
        return 0.0, "Noise"

    # Sum all scores, then normalize to -10 to +10 range
    raw_sum = sum(all_scores)
    # Normalize: divide by count, then scale to -10..+10
    avg_score = raw_sum / len(all_scores)
    # Clamp to -10..+10
    overall_score = max(-10.0, min(10.0, round(avg_score, 2)))

    # Derive signal from score
    if overall_score > 2.0:
        signal = "Positive"
    elif overall_score < -2.0:
        signal = "Negative"
    elif abs(overall_score) > 0.5:
        signal = "Mixed"
    else:
        signal = "Noise"

    return overall_score, signal


def generate_summary(insights: List[SectionalInsight], company: str, q_prev: str, q_curr: str) -> str:
    """Generate a 2-3 sentence summary from the insights."""
    all_takeaways = []
    for insight in insights:
        all_takeaways.extend(insight.key_takeaways[:2])

    if not all_takeaways:
        return f"No significant changes detected between {q_prev} and {q_curr} for {company}."

    return " ".join(all_takeaways[:3])


async def run_pipeline(q_prev_path: str, q_curr_path: str) -> Dict:
    """
    Main pipeline entry point.

    1. Parse both PDFs
    2. Run 4 agents in parallel on Q_t-1 AND Q_t simultaneously (8 agents total)
    3. Run Temporal Delta on all (prev, curr) pairs
    4. Compute evasiveness score
    5. Assemble DashboardPayload

    Returns: DashboardPayload as dict
    """
    start = time.time()
    logger.info("\n" + "=" * 60)
    logger.info("MULTI-AGENT ANALYSIS PIPELINE")
    logger.info("=" * 60)

    # Step 1: Parse PDFs
    step1_start = time.time()
    logger.info("\n[Step 1] Parsing transcripts...")
    data = load_transcript_pair(q_prev_path, q_curr_path)
    company = data["company"]
    q_prev = data["q_prev"]["quarter"]
    q_curr = data["q_curr"]["quarter"]
    text_prev = data["q_prev"]["text"]
    text_curr = data["q_curr"]["text"]
    logger.info(f"  Company: {company}")
    logger.info(f"  Comparing: {q_prev} → {q_curr}")
    step1_time = time.time() - step1_start

    # Step 2: Run all agents on BOTH quarters simultaneously
    step2_start = time.time()
    logger.info("\n[Step 2] Running 8 agents (4 per quarter) + evasiveness in parallel...")
    snapshots_prev, snapshots_curr, evasiveness = await asyncio.gather(
        extract_quarter(text_prev, company, q_prev),
        extract_quarter(text_curr, company, q_curr),
        compute_evasiveness(text_curr, company, q_curr),
    )
    step2_time = time.time() - step2_start

    # Step 3: Temporal Delta comparison
    step3_start = time.time()
    logger.info("\n[Step 3] Running Temporal Delta comparisons...")
    insights = await run_temporal_comparison(snapshots_prev, snapshots_curr, q_prev, q_curr)
    step3_time = time.time() - step3_start

    # Step 4: Validation Agent — cross-check quotes, facts, signals
    step4_start = time.time()
    logger.info("\n[Step 4] Running Validation Agent...")
    from .agents.validation import validate_insights
    insights, validation_score, flagged_count = await validate_insights(
        insights, text_prev, text_curr, q_prev, q_curr
    )
    step4_time = time.time() - step4_start

    # Step 5: Market Validation — cross-check against real market data
    step5_start = time.time()
    logger.info("\n[Step 5] Running Market Validation Agent...")
    from .agents.market_validation import market_validate
    from .parser import NSE_TICKERS
    nse_symbol = NSE_TICKERS.get(company)
    insights, market_alignment_pct, stock_price_change, market_sources = await market_validate(
        insights, company, q_curr, nse_symbol
    )
    step5_time = time.time() - step5_start

    # Step 6: Assemble payload
    logger.info("\n[Step 6] Assembling dashboard payload...")
    overall_score, overall_signal = compute_overall_signal(insights)
    summary = generate_summary(insights, company, q_prev, q_curr)

    payload = DashboardPayload(
        company_ticker=company,
        quarter=q_curr,
        quarter_previous=q_prev,
        executive_evasiveness_score=round(evasiveness, 1),
        insights=insights,
        overall_score=overall_score,
        overall_signal=overall_signal,
        summary=summary,
        validation_score=validation_score,
        flagged_count=flagged_count,
        market_alignment_pct=market_alignment_pct,
        stock_price_change=stock_price_change,
        market_sources=market_sources,
    )

    # Performance logging
    total_time = time.time() - start
    total_metrics = sum(len(i.metrics) for i in insights)
    logger.info(f"\n{'='*60}")
    logger.info("PIPELINE COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"  Company: {company}")
    logger.info(f"  Quarters: {q_prev} → {q_curr}")
    logger.info(f"  Overall Score: {overall_score}")
    logger.info(f"  Overall Signal: {overall_signal}")
    logger.info(f"  Total Metric Deltas: {total_metrics}")
    logger.info(f"  Self-Validation: {validation_score}% verified, {flagged_count} flagged")
    logger.info(f"  Market Alignment: {market_alignment_pct}%")
    logger.info(f"  Stock Change: {stock_price_change:+.1f}%")
    logger.info(f"  Evasiveness Score: {evasiveness}/10")
    logger.info(f"{'='*60}")
    logger.info(f"  Step 1 (Parse):             {step1_time:6.2f}s")
    logger.info(f"  Step 2 (8 Agents):          {step2_time:6.2f}s")
    logger.info(f"  Step 3 (Temporal Delta):     {step3_time:6.2f}s")
    logger.info(f"  Step 4 (Self-Validation):    {step4_time:6.2f}s")
    logger.info(f"  Step 5 (Market Validation):  {step5_time:6.2f}s")
    logger.info(f"  TOTAL:                      {total_time:6.2f}s")
    logger.info(f"{'='*60}")

    return payload.model_dump()


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Multi-Agent Earnings Analysis")
    parser.add_argument("--q-prev", required=True, help="Path to Q_t-1 PDF")
    parser.add_argument("--q-curr", required=True, help="Path to Q_t PDF")
    parser.add_argument("--output", default="output/dashboard_payload.json", help="Output JSON path")
    args = parser.parse_args()

    result = asyncio.run(run_pipeline(args.q_prev, args.q_curr))

    # Save output
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    logger.info(f"\nSaved payload to {out_path}")


if __name__ == "__main__":
    main()
