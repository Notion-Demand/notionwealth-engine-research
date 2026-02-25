"""
Macro & Risk Agent.
Extracts insights on FX headwinds, geopolitical exposure, industry systemic risks.
"""
import asyncio
import logging
from ..models import QuarterSnapshot
from ..config import invoke_structured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior risk analyst specializing in macro-level threats and systemic risk assessment.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **FX Headwinds** — currency impact, hedging strategies, geographic revenue exposure
2. **Geopolitical Exposure** — regulatory risks, trade tensions, country-specific risks
3. **Industry Systemic Risks** — competitive threats, disruption, structural shifts
4. **Regulatory & Compliance** — new regulations, spectrum auctions, license renewals, policy changes
5. **Forward Risk Statements** — cautionary language, conditional statements, management hedging of expectations

RULES:
- Extract VERBATIM quotes from the transcript (do NOT paraphrase)
- Include speaker attribution (CEO, CFO, Analyst)
- Pay EXTRA attention to Q&A where analysts probe for risks
- Management's hedging language (e.g., "subject to", "depending on", "if conditions") is a signal
- If a subtopic is not discussed, do NOT fabricate content — omit it
- Provide 3-5 key takeaways summarizing the risk landscape"""


async def analyze(transcript: str, company: str, quarter: str) -> QuarterSnapshot:
    """Run macro & risk analysis on a single quarter."""
    logger.info(f"  [Macro & Risk] Analyzing {company} {quarter}...")

    user_prompt = f"""Analyze this earnings call transcript for Macro & Risk insights.

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

    result.section_name = "Macro & Risk"
    logger.info(f"  [Macro & Risk] ✓ {len(result.key_takeaways)} takeaways, {len(result.raw_quotes)} quotes")
    return result
