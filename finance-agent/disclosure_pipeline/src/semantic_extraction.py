"""
Semantic extraction module for extracting relevant content from earnings call transcripts.
Uses Google Gen AI SDK directly for reliable JSON mode extraction.
"""
import os
import logging
import json
from typing import Dict
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


EXTRACTION_PROMPT = """You are analyzing an earnings call transcript to extract content for financial disclosure analysis.

The transcript is a dialogue between company executives and analysts.

Your task is to classify and extract content into the following three sections. Each extracted item must be placed in the MOST appropriate primary section.

IMPORTANT: Analyst Q&A responses often contain higher-risk disclosures than prepared remarks.
Pay special attention to management answers during Q&A for implicit or newly revealed risks.

---

### 1. MD&A (Management Discussion & Analysis)
Extract content where management explains:
- Business performance and operating results
- Revenue, cost, margin, or growth drivers
- Operational metrics and execution updates
- Strategic initiatives, investments, or priorities
- Forward-looking statements or outlook
- Management's interpretation of results

Rule:
If the content explains *why performance changed* or *how the business is being run*, classify it as MD&A.

---

### 2. Risk Factors
Extract content that mentions or implies:
- Risks, challenges, or uncertainties
- Competitive, market, macroeconomic, or regulatory pressures
- Demand softness, customer behavior changes, or execution risk
- Credit quality deterioration, vintage risk, collection efficiency issues
- Sensitivity to assumptions (rates, growth, liquidity, macro)
- Conditional, cautionary, or confidence-qualified language about the future

Rule:
If the content answers *what could go wrong*, *what is fragile*, or *what depends on conditions*, classify it as Risk Factors.

Q&A PRIORITY RULE:
If a risk or uncertainty is discussed during analyst Q&A,
extract it EVEN IF it is phrased calmly, optimistically, or indirectly.

DUPLICATION RULE:
If a topic appears in MD&A but also contains risk or uncertainty,
extract the SAME QUOTE again under Risk Factors.

---

### 3. Accounting Content
Extract content related to:
- Accounting policies or changes
- Revenue recognition or cost capitalization methods
- Adjusted vs reported (GAAP / Ind AS) metrics explanations
- One-time items, exceptional items, or normalization
- Estimates, judgments, reserves, provisioning, depreciation, amortization
- Model assumptions (e.g., ECL, PD/LGD/EAD)

Rule:
If the content explains *how numbers are calculated, adjusted, or modeled*, classify it as Accounting.

EXCLUSION RULE:
Do NOT include pure performance metrics, business outcomes,
or funding / capital commentary unless they explicitly explain
an accounting policy, estimate, or calculation method.

---

### IMPORTANT INSTRUCTIONS
- Extract **verbatim quotes** from the transcript (do not paraphrase)
- Preserve speaker attribution when useful (CEO, CFO, Analyst)
- Include enough surrounding context so each quote is understandable standalone
- Combine related discussions across different parts of the call
- Do NOT include moderator instructions, call logistics, or greetings
- If a section is not discussed, explicitly write:
  "No significant discussion of [section] in this transcript."
- Do NOT infer or hallucinate information not stated in the transcript"""


def create_genai_client():
    """Create Google Gen AI client."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not found in environment variables")
    return genai.Client(api_key=api_key)


def extract_semantic_sections(transcript_text: str, company: str, quarter: str) -> Dict[str, str]:
    """
    Use Gemini to semantically extract MD&A, Risk, and Accounting content from transcript.
    Uses direct Google Gen AI SDK with JSON mode for guaranteed structured output.
    
    Args:
        transcript_text: Full earnings call transcript text
        company: Company ticker
        quarter: Quarter label (e.g., "Q1_2024")
        
    Returns:
        Dict with keys: MD&A, Risk_Factors, Accounting
    """
    logger.info(f"Extracting semantic sections for {company} {quarter}...")
    
    # Truncate if too long (keep first ~80% to stay within context window)
    max_chars = 80000  # ~20k tokens
    if len(transcript_text) > max_chars:
        logger.warning(f"Transcript is {len(transcript_text)} chars, truncating to {max_chars}")
        transcript_text = transcript_text[:max_chars] + "\n\n[... remainder truncated ...]"
    
    client = create_genai_client()
    
    user_prompt = f"""Analyze this earnings call transcript and extract the three content categories.

Company: {company}
Quarter: {quarter}

TRANSCRIPT:
{transcript_text}

Extract content into md_a_content, risk_factors_content, and accounting_content fields.
Each field should contain verbatim quotes with speaker attribution."""

    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=EXTRACTION_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema={
                    "type": "OBJECT",
                    "properties": {
                        "md_a_content": {
                            "type": "STRING",
                            "description": "Extracted MD&A discussions with verbatim quotes"
                        },
                        "risk_factors_content": {
                            "type": "STRING",
                            "description": "Extracted risk factor discussions with verbatim quotes"
                        },
                        "accounting_content": {
                            "type": "STRING",
                            "description": "Extracted accounting discussions with verbatim quotes"
                        }
                    },
                    "required": ["md_a_content", "risk_factors_content", "accounting_content"]
                }
            )
        )
        
        # Parse the guaranteed-JSON response
        content = response.text
        parsed = json.loads(content)
        
        md_a = parsed.get("md_a_content", "")
        risk_factors = parsed.get("risk_factors_content", "")
        accounting = parsed.get("accounting_content", "")
        
        logger.info(f"✓ Extracted sections for {company} {quarter}")
        logger.info(f"  MD&A: {len(md_a)} chars")
        logger.info(f"  Risk Factors: {len(risk_factors)} chars")
        logger.info(f"  Accounting: {len(accounting)} chars")
        
        return {
            "MD&A": md_a,
            "Risk_Factors": risk_factors,
            "Accounting": accounting
        }
    
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error for {company} {quarter}: {e}")
        logger.error(f"Response was: {response.text[:500] if response else 'None'}")
        return {
            "MD&A": None,
            "Risk_Factors": None,
            "Accounting": None
        }
    except Exception as e:
        logger.error(f"Error extracting sections for {company} {quarter}: {e}")
        return {
            "MD&A": None,
            "Risk_Factors": None,
            "Accounting": None
        }


if __name__ == "__main__":
    # Test extraction
    sample_transcript = """
    CEO: Thank you for joining our Q2 2024 earnings call. Revenue grew 15% year-over-year to $500M, 
    driven by strong demand in our cloud services segment. However, we did see some temporary headwinds 
    in the European market due to macro uncertainty.
    
    Analyst: Can you discuss the margin compression we saw this quarter?
    
    CFO: Sure. Gross margin decreased from 45% to 42% primarily due to product mix changes and some 
    one-time costs. We also made a change to our depreciation policy for data center equipment, 
    extending useful lives from 4 to 5 years, which partially offset the impact.
    
    Analyst: What are the main risks you're seeing for the second half?
    
    CEO: The main risks are continued macroeconomic uncertainty in Europe, potential supply chain 
    disruptions in Asia, and intensifying competition in our core markets.
    """
    
    result = extract_semantic_sections(sample_transcript, "TEST", "Q2_2024")
    print("\n=== EXTRACTED MD&A ===")
    print(result["MD&A"][:300])
    print("\n=== EXTRACTED RISKS ===")
    print(result["Risk_Factors"][:300])
    print("\n=== EXTRACTED ACCOUNTING ===")
    print(result["Accounting"][:300])
