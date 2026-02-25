"""
Revenue & Growth Agent.
Extracts insights on pricing power, customer churn, volume vs price mix, market expansion.
"""
import asyncio
import logging
from ..models import QuarterSnapshot
from ..config import invoke_structured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior equity research analyst specializing in revenue quality and growth analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Pricing Power** — tariff hikes, ARPU trends, ability to raise prices, pricing discipline
2. **Customer Churn** — subscriber trends, retention metrics, churn rates, customer additions
3. **Volume vs Price Mix** — whether growth is volume-driven or price-driven
4. **New Market Expansion** — geographic expansion, new products, new segments, adjacencies
5. **Revenue Quality** — recurring vs one-time, contract duration, visibility

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Focus on both prepared remarks AND Q&A answers
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways on revenue quality and growth trajectory"""


async def analyze(transcript: str, company: str, quarter: str) -> QuarterSnapshot:
    """Run revenue & growth analysis on a single quarter."""
    logger.info(f"  [Revenue & Growth] Analyzing {company} {quarter}...")

    user_prompt = f"""Analyze this earnings call transcript for Revenue & Growth insights.

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

    result.section_name = "Revenue & Growth"
    logger.info(f"  [Revenue & Growth] ✓ {len(result.key_takeaways)} takeaways, {len(result.raw_quotes)} quotes")
    return result
