"""
Semantic extraction module for extracting relevant content from earnings call transcripts.
Uses Gemini to intelligently identify MD&A, Risk, and Accounting-related discussions.
"""
import os
import logging
import json
import re
from typing import Dict, Optional
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ExtractedSections(BaseModel):
    """Semantically extracted sections from earnings call transcript."""
    md_a_content: str = Field(
        description="Key discussions about business performance, revenue drivers, operations, margins, growth, strategy, and management commentary on results"
    )
    risk_factors_content: str = Field(
        description="Discussions about risks, challenges, concerns, headwinds, uncertainties, competitive threats, regulatory issues, and potential problems"
    )
    accounting_content: str = Field(
        description="Discussions about accounting policies, estimates, critical accounting decisions, revenue recognition, depreciation, reserves, or financial methodology changes"
    )

# FIRST PROMPT-------------------
# EXTRACTION_PROMPT = """You are analyzing an earnings call transcript to extract relevant content for financial disclosure analysis.

# The transcript is a dialogue between company executives and analysts. Your task is to identify and extract:

# 1. **MD&A Content** (Management Discussion & Analysis):
#    - Business performance discussions
#    - Revenue drivers and growth commentary  
#    - Operational updates and metrics
#    - Margin and profitability discussions
#    - Strategic initiatives and outlook
#    - Management's interpretation of results

# 2. **Risk Factors Content**:
#    - Risks, challenges, and concerns mentioned
#    - Competitive pressures or threats
#    - Market headwinds or uncertainties
#    - Regulatory or compliance issues
#    - Supply chain or operational risks
#    - Any mentions of potential problems or vulnerabilities

# 3. **Accounting Content**:
#    - Accounting policy discussions or changes
#    - Critical accounting estimates or judgments
#    - Revenue recognition methodology
#    - Depreciation, amortization approaches
#    - Reserve calculations or changes
#    - Any technical accounting explanations

# **IMPORTANT INSTRUCTIONS**:
# - Extract verbatim quotes and discussions (preserve speaker context where helpful)
# - Include enough context so the extracted content makes sense standalone
# - If a topic isn't discussed in the transcript, write "No significant discussion of [topic] in this transcript"
# - Combine related discussions from different parts of the call
# - Preserve the conversational nature but organize by theme

# **FORMAT**:
# Return structured extraction with the three sections populated."""

# SECOND PROMPT -----------------
# EXTRACTION_PROMPT = """You are analyzing an earnings call transcript to extract content for financial disclosure analysis.

# The transcript is a dialogue between company executives and analysts.

# Your task is to classify and extract content into the following three sections. Each extracted item must be placed in the MOST appropriate primary section.

# ---

# ### 1. MD&A (Management Discussion & Analysis)
# Extract content where management explains:
# - Business performance and operating results
# - Revenue, cost, margin, or growth drivers
# - Operational metrics and execution updates
# - Strategic initiatives, investments, or priorities
# - Forward-looking statements or outlook
# - Management’s interpretation of results

# Rule: If the content explains *why performance changed*, classify it as MD&A.

# ---

# ### 2. Risk Factors
# Extract content that mentions or implies:
# - Risks, challenges, or uncertainties
# - Competitive, market, macroeconomic, or regulatory pressures
# - Demand softness, customer behavior changes, or execution risk
# - Supply chain, operational, or geopolitical issues
# - Conditional or cautionary language about the future

# Rule: If the content answers *what could go wrong*, classify it as Risk Factors.
# Include both explicit and implicit risks.

# ---

# ### 3. Accounting Content
# Extract content related to:
# - Accounting policies or changes
# - Revenue recognition or cost capitalization methods
# - Adjusted vs GAAP metrics explanations
# - One-time items, non-recurring charges, or normalization
# - Estimates, judgments, reserves, depreciation, or amortization

# Rule: If the content explains *how numbers are calculated or presented*, classify it as Accounting.

# ---

# ### IMPORTANT INSTRUCTIONS
# - Extract **verbatim quotes** from the transcript (do not paraphrase)
# - Preserve speaker attribution when useful (e.g., CEO, CFO, Analyst)
# - Include enough surrounding context for each quote to be understandable standalone
# - Combine related discussions across different parts of the call
# - If a section is not discussed, explicitly write:
#   "No significant discussion of [section] in this transcript."
# - Do NOT infer or hallucinate information not stated in the transcript

# ---

# ### OUTPUT FORMAT
# Return the result in the following structure:

# MD&A:
# - [Verbatim quote + context]

# Risk Factors:
# - [Verbatim quote + context]

# Accounting:
# - [Verbatim quote + context]

# """


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
- Management’s interpretation of results

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

🔧 Q&A PRIORITY RULE:
If a risk or uncertainty is discussed during analyst Q&A,
extract it EVEN IF it is phrased calmly, optimistically, or indirectly.

🔧 DUPLICATION RULE:
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

🔧 EXCLUSION RULE:
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
- Do NOT infer or hallucinate information not stated in the transcript

---

### OUTPUT FORMAT
Return the result in the following structure:

MD&A:
- [Verbatim quote + context]

Risk Factors:
- [Verbatim quote + context]

Accounting:
- [Verbatim quote + context]
"""


def create_extraction_llm() -> ChatGoogleGenerativeAI:
    """Create Gemini LLM for extraction."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not found in environment variables")
    
    return ChatGoogleGenerativeAI(
        model="gemini-1.5-flash",
        temperature=0.1,  # Low temperature for consistent extraction
        google_api_key=api_key,
        convert_system_message_to_human=True  # Required for system prompts
    )


def extract_semantic_sections(transcript_text: str, company: str, quarter: str) -> Dict[str, str]:
    """
    Use Gemini to semantically extract MD&A, Risk, and Accounting content from transcript.
    
    Args:
        transcript_text: Full earnings call transcript text
        company: Company ticker
        quarter: Quarter label (e.g., "Q1_2024")
        
    Returns:
        Dict with keys: MD&A, Risk_Factors, Accounting
    """
    logger.info(f"Extracting semantic sections for {company} {quarter}...")
    
    # Truncate if too long (keep first ~80% to stay in context window)
    max_chars = 80000  # ~20k tokens
    if len(transcript_text) > max_chars:
        logger.warning(f"Transcript is {len(transcript_text)} chars, truncating to {max_chars}")
        transcript_text = transcript_text[:max_chars] + "\n\n[... remainder truncated ...]"
    
    llm = create_extraction_llm()
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", EXTRACTION_PROMPT),
        ("human", """Analyze this earnings call transcript and extract the three content categories.

Company: {company}
Quarter: {quarter}

TRANSCRIPT:
{transcript}

Return your analysis as a JSON object with this structure:
{{
  "md_a_content": "extracted MD&A discussions...",
  "risk_factors_content": "extracted risk discussions...",
  "accounting_content": "extracted accounting discussions..."
}}

Return ONLY valid JSON, no markdown formatting or extra text.""")
    ])
    
    chain = prompt | llm
    
    try:
        response = chain.invoke({
            "company": company,
            "quarter": quarter,
            "transcript": transcript_text
        })
        
        # Parse the response manually
        content = response.content if hasattr(response, 'content') else str(response)
        
        # Remove markdown code fences if present
        json_match = re.search(r'```(?:json)?\s*(\{.*?})\s*```', content, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find raw JSON
            json_match = re.search(r'\{.*?\}', content, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
            else:
                # JSON not found, log and return empty
                logger.warning(f"Could not find JSON in response for {company} {quarter}")
                logger.debug(f"Response content: {content[:500]}...")
                return {
                    "MD&A": "No MD&A content extracted",
                    "Risk_Factors": "No risk factors extracted",
                    "Accounting": "No accounting content extracted"
                }
        
        parsed = json.loads(json_str)
        
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
