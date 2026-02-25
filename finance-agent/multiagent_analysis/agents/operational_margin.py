"""
Operational Margin Agent.
Extracts insights on supply chain costs, labor inflation, OPEX, accounting policy changes.
"""
import asyncio
import logging
from ..models import QuarterSnapshot
from ..config import invoke_structured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior financial analyst specializing in operating efficiency and margin analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Supply Chain Costs** — input costs, vendor dependencies, procurement changes
2. **Labor Inflation** — employee costs, wage pressures, headcount changes
3. **OPEX Adjustments** — SG&A trends, cost optimization, efficiency programs
4. **Margin Trajectory** — EBITDA/operating margin changes, margin guidance, mix effects
5. **Accounting Policy Changes** — depreciation changes, capitalization, recognition, one-time items

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Focus on both prepared remarks AND Q&A answers
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways summarizing operational efficiency and margin outlook"""


async def analyze(transcript: str, company: str, quarter: str) -> QuarterSnapshot:
    """Run operational margin analysis on a single quarter."""
    logger.info(f"  [Operational Margin] Analyzing {company} {quarter}...")

    user_prompt = f"""Analyze this earnings call transcript for Operational Margin insights.

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

    result.section_name = "Operational Margin"
    logger.info(f"  [Operational Margin] ✓ {len(result.key_takeaways)} takeaways, {len(result.raw_quotes)} quotes")
    return result
