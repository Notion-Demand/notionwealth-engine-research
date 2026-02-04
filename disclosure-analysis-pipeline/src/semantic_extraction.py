"""
Semantic extraction module for extracting relevant content from earnings call transcripts.
Uses Gemini to intelligently identify MD&A, Risk, and Accounting-related discussions.
"""
import os
import logging
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


EXTRACTION_PROMPT = """You are analyzing an earnings call transcript to extract relevant content for financial disclosure analysis.

The transcript is a dialogue between company executives and analysts. Your task is to identify and extract:

1. **MD&A Content** (Management Discussion & Analysis):
   - Business performance discussions
   - Revenue drivers and growth commentary  
   - Operational updates and metrics
   - Margin and profitability discussions
   - Strategic initiatives and outlook
   - Management's interpretation of results

2. **Risk Factors Content**:
   - Risks, challenges, and concerns mentioned
   - Competitive pressures or threats
   - Market headwinds or uncertainties
   - Regulatory or compliance issues
   - Supply chain or operational risks
   - Any mentions of potential problems or vulnerabilities

3. **Accounting Content**:
   - Accounting policy discussions or changes
   - Critical accounting estimates or judgments
   - Revenue recognition methodology
   - Depreciation, amortization approaches
   - Reserve calculations or changes
   - Any technical accounting explanations

**IMPORTANT INSTRUCTIONS**:
- Extract verbatim quotes and discussions (preserve speaker context where helpful)
- Include enough context so the extracted content makes sense standalone
- If a topic isn't discussed in the transcript, write "No significant discussion of [topic] in this transcript"
- Combine related discussions from different parts of the call
- Preserve the conversational nature but organize by theme

**FORMAT**:
Return structured extraction with the three sections populated."""


def create_extraction_llm() -> ChatGoogleGenerativeAI:
    """Create Gemini LLM for extraction."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not found in environment variables")
    
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash-lite",
        temperature=0.1,  # Low temperature for consistent extraction
        google_api_key=api_key
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

Extract MD&A content, Risk Factors content, and Accounting content following the instructions.""")
    ])
    
    # Create structured output chain
    structured_llm = llm.with_structured_output(ExtractedSections)
    chain = prompt | structured_llm
    
    try:
        result = chain.invoke({
            "company": company,
            "quarter": quarter,
            "transcript": transcript_text
        })
        
        logger.info(f"✓ Extracted sections for {company} {quarter}")
        logger.info(f"  MD&A: {len(result.md_a_content)} chars")
        logger.info(f"  Risk Factors: {len(result.risk_factors_content)} chars")
        logger.info(f"  Accounting: {len(result.accounting_content)} chars")
        
        return {
            "MD&A": result.md_a_content,
            "Risk_Factors": result.risk_factors_content,
            "Accounting": result.accounting_content
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
