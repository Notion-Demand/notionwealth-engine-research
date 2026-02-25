"""
Capital & Liquidity Agent.
Extracts insights on FCF, CapEx, Debt structure, Covenants, Buybacks/Dividends.
"""
import asyncio
import logging
from ..models import QuarterSnapshot
from ..config import invoke_structured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior credit analyst specializing in capital structure and liquidity analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Free Cash Flow (FCF)** — generation, conversion, trends, guidance
2. **Capital Expenditure (CapEx)** — plans, changes, intensity
3. **Debt Structure** — total debt, maturity profile, cost of debt, refinancing
4. **Covenants** — any covenant discussions, headroom, compliance
5. **Shareholder Returns** — buybacks, dividends, payout ratios

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Focus on both prepared remarks AND Q&A answers
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways summarizing the capital & liquidity position"""


async def analyze(transcript: str, company: str, quarter: str) -> QuarterSnapshot:
    """Run capital & liquidity analysis on a single quarter."""
    logger.info(f"  [Capital & Liquidity] Analyzing {company} {quarter}...")

    user_prompt = f"""Analyze this earnings call transcript for Capital & Liquidity insights.

Company: {company}
Quarter: {quarter}

TRANSCRIPT:
{transcript}"""

    result = await asyncio.to_thread(
        invoke_structured,
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        schema=QuarterSnapshot,
    )

    result.section_name = "Capital & Liquidity"
    logger.info(f"  [Capital & Liquidity] ✓ {len(result.key_takeaways)} takeaways, {len(result.raw_quotes)} quotes")
    return result
