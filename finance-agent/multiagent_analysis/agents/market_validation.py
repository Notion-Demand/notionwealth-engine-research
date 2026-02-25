"""
Market Validation Agent — External Market Cross-Check.
Validates analysis signals against real market data using:
1. yfinance for stock price movement post-earnings
2. Gemini + Google Search grounding for analyst sentiment / market news

Runs AFTER the self-validation agent (transcript fact-checking).
"""
import asyncio
import re
import logging
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from ..models import SectionalInsight, MetricDelta
from ..config import invoke_grounded

logger = logging.getLogger(__name__)


# ── Stock Price Data ──────────────────────────────────────────────────────

def get_stock_price_change(nse_symbol: str, quarter: str) -> Optional[float]:
    """
    Get stock price change around the earnings period using yfinance.
    Returns percentage change over the last 30 days, or None if unavailable.
    """
    try:
        import yfinance as yf

        ticker = yf.Ticker(nse_symbol)
        # Get 3 months of history to capture the earnings period
        hist = ticker.history(period="3mo")

        if hist.empty or len(hist) < 5:
            logger.warning(f"  Insufficient price data for {nse_symbol}")
            return None

        # Use last 30 trading days for the earnings reaction
        recent = hist.tail(30)
        if len(recent) < 2:
            return None

        price_start = recent.iloc[0]["Close"]
        price_end = recent.iloc[-1]["Close"]
        pct_change = ((price_end - price_start) / price_start) * 100

        logger.info(f"  Stock {nse_symbol}: {price_start:.2f} → {price_end:.2f} ({pct_change:+.1f}%)")
        return round(pct_change, 2)

    except Exception as e:
        logger.warning(f"  yfinance error for {nse_symbol}: {e}")
        return None


# ── Market Sentiment via Google Search ────────────────────────────────────

MARKET_SYSTEM_PROMPT = """You are a financial market analyst validating AI-generated earnings analysis against real market data.

You will receive:
1. A company name and quarter
2. A list of AI-generated signals with their classifications (Positive/Negative/Noise)
3. The recent stock price movement

Your task: Search for recent analyst reports, market reactions, and financial news for this company's most recent earnings. For EACH signal, determine whether the market agrees with the classification.

For each signal, respond with:
- **aligned**: Market data/analyst consensus confirms the signal direction
- **divergent**: Market data/analyst consensus contradicts the signal — explain why
- **unclear**: Not enough market data to validate this specific signal

Be specific. Reference real market data, analyst views, or stock movements in your reasoning.

Format your response as:
SIGNAL: [subtopic name]
STATUS: [aligned/divergent/unclear]
REASON: [1-2 sentence explanation with market evidence]

Repeat for each signal. End with a SUMMARY line."""


async def search_market_sentiment(
    company: str,
    quarter: str,
    signals: List[Dict],
    stock_change: Optional[float],
) -> Tuple[str, List[str]]:
    """
    Use Gemini + Google Search to validate signals against market consensus.
    Returns (analysis_text, source_urls).
    """
    # Build the signals list for the prompt
    signals_text = ""
    for s in signals:
        signals_text += f"- {s['subtopic']}: {s['signal']} (score: {s['score']:+.1f}) — {s['shift']}\n"

    stock_info = f"Stock price change (last 30 days): {stock_change:+.1f}%" if stock_change is not None else "Stock price data unavailable"

    user_prompt = f"""Validate these AI-generated earnings signals for **{company}** ({quarter}) against real market data:

SIGNALS TO VALIDATE:
{signals_text}

STOCK DATA:
{stock_info}

Search for recent analyst reports, broker notes, and market commentary on {company}'s {quarter} earnings. For each signal, determine if the market agrees (aligned), disagrees (divergent), or if there's insufficient data (unclear)."""

    try:
        text, urls = await asyncio.to_thread(
            invoke_grounded,
            system_prompt=MARKET_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        )
        return text, urls
    except Exception as e:
        logger.error(f"  Market search failed: {e}")
        return "", []


def parse_market_response(response_text: str) -> Dict[str, Dict[str, str]]:
    """Parse the market validation response into per-signal results."""
    results = {}
    current_signal = None

    for line in response_text.split("\n"):
        line = line.strip()
        if not line:
            continue

        if line.startswith("SIGNAL:"):
            current_signal = line.replace("SIGNAL:", "").strip()
        elif line.startswith("STATUS:") and current_signal:
            status = line.replace("STATUS:", "").strip().lower()
            if status not in ("aligned", "divergent", "unclear"):
                status = "unclear"
            results.setdefault(current_signal, {})["status"] = status
        elif line.startswith("REASON:") and current_signal:
            reason = line.replace("REASON:", "").strip()
            results.setdefault(current_signal, {})["reason"] = reason

    return results


# ── Main Entry Point ──────────────────────────────────────────────────────

async def market_validate(
    insights: List[SectionalInsight],
    company: str,
    quarter: str,
    nse_symbol: Optional[str] = None,
) -> Tuple[List[SectionalInsight], float, float, List[str]]:
    """
    Validate analysis signals against market data.
    
    Args:
        insights: Post-self-validation insights
        company: Company ticker (e.g. "BHARTI")
        quarter: Current quarter (e.g. "Q3_2026")
        nse_symbol: yfinance NSE symbol (e.g. "BHARTIARTL.NS")
    
    Returns:
        (validated_insights, market_alignment_pct, stock_price_change, source_urls)
    """
    logger.info(f"\n[Market Validation] Validating {company} {quarter} against market data...")

    # Step 1: Get stock price movement
    stock_change = None
    if nse_symbol:
        stock_change = await asyncio.to_thread(get_stock_price_change, nse_symbol, quarter)
    
    # Step 2: Collect all non-removed signals
    all_signals = []
    for insight in insights:
        for m in insight.metrics:
            if m.validation_status != "removed":
                all_signals.append({
                    "subtopic": m.subtopic,
                    "signal": m.signal_classification,
                    "score": m.signal_score,
                    "shift": m.language_shift,
                    "section": insight.section_name,
                })

    if not all_signals:
        logger.info("  No signals to validate against market")
        return insights, 100.0, stock_change or 0.0, []

    # Step 3: Ask Gemini + Google Search for market validation
    market_text, source_urls = await search_market_sentiment(
        company, quarter, all_signals, stock_change
    )

    # Step 4: Parse response and apply to metrics
    market_results = parse_market_response(market_text)

    aligned_count = 0
    total_checked = 0

    for insight in insights:
        for metric in insight.metrics:
            if metric.validation_status == "removed":
                continue

            # Try to find this metric in market results (fuzzy match on subtopic)
            result = market_results.get(metric.subtopic)
            if not result:
                # Try partial match
                for key, val in market_results.items():
                    if metric.subtopic.lower() in key.lower() or key.lower() in metric.subtopic.lower():
                        result = val
                        break

            if result:
                metric.market_validation = result.get("status", "unclear")
                metric.market_note = result.get("reason", "")
                total_checked += 1
                if metric.market_validation == "aligned":
                    aligned_count += 1
                if metric.market_validation == "divergent":
                    logger.warning(f"  ⚡ DIVERGENT: {metric.subtopic} — {metric.market_note}")
                else:
                    logger.info(f"  ✓ {metric.market_validation.upper()}: {metric.subtopic}")

    alignment_pct = (aligned_count / total_checked * 100) if total_checked > 0 else 0.0
    logger.info(f"  Market Alignment: {alignment_pct:.1f}% ({aligned_count}/{total_checked})")
    logger.info(f"  Stock Change: {stock_change:+.1f}%" if stock_change else "  Stock data unavailable")
    logger.info(f"  Sources: {len(source_urls)} citations")

    return insights, round(alignment_pct, 1), stock_change or 0.0, source_urls
