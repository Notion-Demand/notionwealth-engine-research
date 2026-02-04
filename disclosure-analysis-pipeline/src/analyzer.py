"""
LLM-based disclosure change analysis using Google Gemini.
"""
import os
import logging
from typing import List, Dict, Optional
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from .models import DisclosureChange, SectionComparison, SignalClassification

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a financial disclosure analyst detecting meaningful changes between quarterly filings.

**RULES:**
1. **Ignore boilerplate**: Skip page numbers, headers, footers, and pure formatting changes
2. **Detect LANGUAGE SHIFTS**: Identify tone changes like:
   - "temporary" → "structural" (negative signal)
   - "strong" → "moderate" (negative signal)  
   - "headwinds" → "tailwinds" (positive signal)
   - "challenging" → "improving" (positive signal)

3. **Detect NEW SPECIFICITY**: Identify transitions from vague to specific:
   - "market volatility" → "European demand weakness in automotive sector" (more informative)
   - "supply chain issues" → "chip shortage delays of 6-8 weeks" (more specific)

4. **Detect ACCOUNTING CHANGES**: Flag policy updates:
   - Inventory valuation method changes
   - Useful life adjustments for depreciation
   - Revenue recognition policy updates
   - Reserve estimate changes

5. **Signal Classification**:
   - **Positive**: Improvements, strengthening position, risk reduction, favorable trends
   - **Negative**: New risks, deteriorating conditions, weakening metrics, concerns
   - **Noise**: Neutral updates, rewordings with no substantive change

**OUTPUT REQUIREMENTS:**
- Extract ONLY changes that matter for investment analysis
- Quote verbatim text (under 100 words each)
- Provide one clear sentence describing the change
- If sections are identical or have only trivial changes, return an empty list

**CRITICAL**: Be selective. Return 0-5 changes per section comparison. Quality over quantity."""


def create_gemini_llm(temperature: float = 0.1) -> ChatGoogleGenerativeAI:
    """Create Gemini LLM instance."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not found in environment variables")
    
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash-lite",  # Use gemini-pro for v1beta API compatibility
        temperature=temperature,
        google_api_key=api_key,
        convert_system_message_to_human=True  # Required for system prompts
    )


def compare_sections(
    section_name: str,
    text_previous: Optional[str],
    text_current: Optional[str],
    llm: ChatGoogleGenerativeAI
) -> List[DisclosureChange]:
    """
    Compare two versions of the same section using LLM.
    Returns list of detected changes.
    """
    if not text_previous or not text_current:
        logger.warning(f"Missing text for {section_name}, skipping comparison")
        return []
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", """Compare these two versions of the {section} section and identify meaningful changes.

**Previous Quarter:**
{text_old}

**Current Quarter:**
{text_new}

Return your analysis as a JSON object with this structure:
{{
  "changes": [
    {{
      "section": "{section}",
      "quote_old": "verbatim quote from previous quarter",
      "quote_new": "verbatim quote from current quarter",
      "description_of_change": "one-sentence description",
      "signal_classification": "Positive" | "Negative" | "Noise"
    }}
  ]
}}

Return ONLY valid JSON, no markdown formatting or extra text.""")
    ])
    
    chain = prompt | llm
    
    try:
        logger.info(f"Analyzing {section_name} section...")
        response = chain.invoke({
            "section": section_name,
            "text_old": text_previous[:10000],  # Truncate for token limits
            "text_new": text_current[:10000]
        })
        
        # Parse the response manually
        import json
        import re
        
        # Extract JSON from response (handles markdown code blocks)
        content = response.content if hasattr(response, 'content') else str(response)
        
        # Remove markdown code fences if present
        json_match = re.search(r'```(?:json)?\s*(\{.*\})\s*```', content, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find raw JSON
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            json_str = json_match.group(0) if json_match else content
        
        parsed = json.loads(json_str)
        
        # Convert to DisclosureChange objects
        changes = []
        for change_dict in parsed.get("changes", []):
            try:
                change = DisclosureChange(
                    section=change_dict.get("section", section_name),
                    quote_old=change_dict["quote_old"],
                    quote_new=change_dict["quote_new"],
                    description_of_change=change_dict["description_of_change"],
                    signal_classification=SignalClassification(change_dict["signal_classification"])
                )
                changes.append(change)
            except (KeyError, ValueError) as e:
                logger.warning(f"Skipping malformed change: {e}")
                continue
        
        logger.info(f"  {section_name}: {len(changes)} changes detected")
        return changes
        
    except Exception as e:
        logger.error(f"Error comparing {section_name}: {e}")
        return []


def compare_quarters(
    company: str,
    quarter_current: str,
    quarter_previous: str,
    data_current: Dict[str, Optional[str]],
    data_previous: Dict[str, Optional[str]],
    llm: ChatGoogleGenerativeAI
) -> List[DisclosureChange]:
    """
    Compare all sections between two quarters for a company.
    
    Args:
        company: Company ticker
        quarter_current: Current quarter label (e.g., "Q1_2024")
        quarter_previous: Previous quarter label
        data_current: Dict with section texts from current quarter
        data_previous: Dict with section texts from previous quarter
        llm: Configured Gemini LLM instance
        
    Returns:
        Combined list of all detected changes
    """
    all_changes = []
    
    logger.info(f"\n{'='*60}")
    logger.info(f"Comparing {company}: {quarter_previous} → {quarter_current}")
    logger.info(f"{'='*60}\n")
    
    # Compare each section
    sections = ["MD&A", "Risk_Factors", "Accounting"]
    
    for section in sections:
        changes = compare_sections(
            section_name=section,
            text_previous=data_previous.get(section),
            text_current=data_current.get(section),
            llm=llm
        )
        all_changes.extend(changes)
    
    logger.info(f"Total changes for {company} {quarter_current}: {len(all_changes)}\n")
    return all_changes


def analyze_all_companies(
    parsed_data: Dict,
    dry_run: bool = False
) -> List[Dict]:
    """
    Analyze disclosure changes for all companies across quarters.
    
    Args:
        parsed_data: Nested dict from parser {company: {quarter: {section: text}}}
        dry_run: If True, skip LLM calls (for testing)
        
    Returns:
        List of change records for CSV output
    """
    if not dry_run:
        llm = create_gemini_llm()
    else:
        llm = None
        logger.info("DRY RUN MODE: Skipping LLM calls")
    
    results = []
    
    for company, quarters_data in parsed_data.items():
        # Sort quarters chronologically
        quarters = sorted(quarters_data.keys(), key=lambda q: (q.split('_')[1], q.split('_')[0]))
        
        logger.info(f"\nProcessing {company}: {len(quarters)} quarters found")
        
        # Compare consecutive quarters
        for i in range(1, len(quarters)):
            q_prev = quarters[i - 1]
            q_curr = quarters[i]
            
            if dry_run:
                logger.info(f"Would compare {q_prev} → {q_curr}")
                continue
            
            changes = compare_quarters(
                company=company,
                quarter_current=q_curr,
                quarter_previous=q_prev,
                data_current=quarters_data[q_curr],
                data_previous=quarters_data[q_prev],
                llm=llm
            )
            
            # Convert to records for CSV
            for change in changes:
                results.append({
                    "Company": company,
                    "Quarter_Previous": q_prev,
                    "Quarter_Current": q_curr,
                    "Section": change.section,
                    "Quote_Old": change.quote_old,
                    "Quote_New": change.quote_new,
                    "Description": change.description_of_change,
                    "Signal": change.signal_classification.value
                })
    
    logger.info(f"\n{'='*60}")
    logger.info(f"ANALYSIS COMPLETE: {len(results)} total changes detected")
    logger.info(f"{'='*60}\n")
    
    return results


if __name__ == "__main__":
    # Test with sample data
    import json
    
    with open("output/parsed_data.json", "r") as f:
        data = json.load(f)
    
    results = analyze_all_companies(data, dry_run=True)
    print(f"Found {len(results)} changes")
