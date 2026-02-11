"""
Judge LLM Evaluation System for Disclosure Pipeline.

Validates accuracy across 4 stages:
1. Semantic Extraction Quality
2. Change Detection Validity
3. Signal Classification Correctness
4. Verdict Quality

Each validation returns structured scores (0-100) and flags issues.
"""

import os
import json
import logging
import re
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

load_dotenv()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Judge LLM Setup
# ---------------------------------------------------------------------

def create_judge_llm() -> ChatGoogleGenerativeAI:
    """Create a judge LLM instance (using same model for consistency)."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not found")
    
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.0,  # Zero temperature for consistent evaluation
        google_api_key=api_key,
        convert_system_message_to_human=True
    )


# ---------------------------------------------------------------------
# Stage 1: Semantic Extraction Validation
# ---------------------------------------------------------------------

EXTRACTION_JUDGE_PROMPT = """You are evaluating the quality of text extracted from a financial disclosure PDF.

**Section Type**: {section_name}

**Extracted Text**:
{extracted_text}

**Evaluation Criteria**:
1. **Relevance**: Does the text contain content relevant to {section_name}?
2. **Completeness**: Does it appear to be a reasonable extraction (not cut off mid-sentence, not missing critical info)?
3. **Quality**: Is the text clean (no major OCR errors, formatting issues, or gibberish)?

**Output JSON**:
{{
  "quality_score": 0-100,
  "is_relevant": true/false,
  "has_meaningful_content": true/false,
  "issues": ["list of specific problems found, if any"],
  "reasoning": "brief explanation of score"
}}
"""


def validate_extraction(
    section_name: str,
    extracted_text: str,
    llm: ChatGoogleGenerativeAI
) -> Dict:
    """
    Validate that extracted section text is high quality and relevant.
    
    Returns:
        {
            "quality_score": 0-100,
            "is_relevant": bool,
            "has_meaningful_content": bool,
            "issues": List[str],
            "reasoning": str
        }
    """
    if not extracted_text or len(extracted_text) < 50:
        return {
            "quality_score": 0,
            "is_relevant": False,
            "has_meaningful_content": False,
            "issues": ["Extracted text is too short or empty"],
            "reasoning": "Insufficient content to evaluate"
        }
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an expert evaluator of financial document extraction quality."),
        ("human", EXTRACTION_JUDGE_PROMPT)
    ])
    
    chain = prompt | llm
    response = chain.invoke({
        "section_name": section_name,
        "extracted_text": extracted_text[:5000]  # Sample for evaluation
    })
    
    content = response.content if hasattr(response, "content") else str(response)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    
    if match:
        return json.loads(match.group(0))
    else:
        logger.warning("Failed to parse extraction validation response")
        return {
            "quality_score": 50,
            "is_relevant": True,
            "has_meaningful_content": True,
            "issues": ["Could not parse judge response"],
            "reasoning": "Evaluation inconclusive"
        }


# ---------------------------------------------------------------------
# Stage 2: Change Detection Validation
# ---------------------------------------------------------------------

CHANGE_JUDGE_PROMPT = """You are validating a detected change between two quarterly disclosures.

**Detected Change**:
- Section: {section}
- Old Quote: "{quote_old}"
- New Quote: "{quote_new}"
- Description: {description}

**Source Context**:
PREVIOUS QUARTER TEXT (excerpt):
{text_prev}

CURRENT QUARTER TEXT (excerpt):
{text_curr}

**Validation Tasks**:
1. **Quote Accuracy**: Verify both quotes actually appear in their respective source texts (or are close paraphrases)
2. **Comparability**: Check if old/new quotes refer to the same type of concept (e.g., don't compare accounting policy to operating commentary)
3. **Description Accuracy**: Check if the description correctly characterizes the change

**Output JSON**:
{{
  "quote_accuracy_score": 0-100,
  "comparability_score": 0-100,
  "description_accuracy_score": 0-100,
  "overall_validity": 0-100,
  "issues": ["specific validation failures"],
  "reasoning": "explanation"
}}
"""


def validate_change(
    change: Dict,
    text_prev: str,
    text_curr: str,
    llm: ChatGoogleGenerativeAI
) -> Dict:
    """
    Validate that a detected change is accurate and comparable.
    
    Args:
        change: Dict with keys: Section, Quote_Old, Quote_New, Description
        text_prev: Full text from previous quarter (for context)
        text_curr: Full text from current quarter (for context)
    
    Returns:
        {
            "quote_accuracy_score": 0-100,
            "comparability_score": 0-100,
            "description_accuracy_score": 0-100,
            "overall_validity": 0-100,
            "issues": List[str],
            "reasoning": str
        }
    """
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are validating disclosure change detections for accuracy."),
        ("human", CHANGE_JUDGE_PROMPT)
    ])
    
    chain = prompt | llm
    response = chain.invoke({
        "section": change.get("Section", "Unknown"),
        "quote_old": change.get("Quote_Old", ""),
        "quote_new": change.get("Quote_New", ""),
        "description": change.get("Description", ""),
        "text_prev": text_prev[:8000],  # Context window
        "text_curr": text_curr[:8000]
    })
    
    content = response.content if hasattr(response, "content") else str(response)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    
    if match:
        return json.loads(match.group(0))
    else:
        logger.warning("Failed to parse change validation response")
        return {
            "quote_accuracy_score": 70,
            "comparability_score": 70,
            "description_accuracy_score": 70,
            "overall_validity": 70,
            "issues": ["Could not parse judge response"],
            "reasoning": "Evaluation inconclusive"
        }


# ---------------------------------------------------------------------
# Stage 3: Signal Classification Validation
# ---------------------------------------------------------------------

SIGNAL_JUDGE_PROMPT = """You are validating the signal classification of a detected disclosure change.

**Change Details**:
- Section: {section}
- Quote (New): "{quote_new}"
- Description: {description}
- Assigned Signal: {signal}

**Signal Definitions**:
- **Positive**: Structural improvements or durable risk reduction
- **Negative**: Structural deterioration or newly revealed risk
- **Noise**: One-time, compliance-driven, or purely explanatory changes

**Validation Task**:
Assess whether the assigned signal ({signal}) is appropriate for this change.

**Output JSON**:
{{
  "signal_correctness_score": 0-100,
  "is_correct_signal": true/false,
  "suggested_signal": "Positive|Negative|Noise",
  "reasoning": "explanation of why signal is correct or should be changed"
}}
"""


def validate_signal(
    change: Dict,
    llm: ChatGoogleGenerativeAI
) -> Dict:
    """
    Validate that the signal classification is appropriate.
    
    Args:
        change: Dict with keys: Section, Quote_New, Description, Signal
    
    Returns:
        {
            "signal_correctness_score": 0-100,
            "is_correct_signal": bool,
            "suggested_signal": str,
            "reasoning": str
        }
    """
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are validating signal classifications for financial disclosure changes."),
        ("human", SIGNAL_JUDGE_PROMPT)
    ])
    
    chain = prompt | llm
    response = chain.invoke({
        "section": change.get("Section", "Unknown"),
        "quote_new": change.get("Quote_New", ""),
        "description": change.get("Description", ""),
        "signal": change.get("Signal", "Unknown")
    })
    
    content = response.content if hasattr(response, "content") else str(response)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    
    if match:
        return json.loads(match.group(0))
    else:
        logger.warning("Failed to parse signal validation response")
        return {
            "signal_correctness_score": 70,
            "is_correct_signal": True,
            "suggested_signal": change.get("Signal", "Noise"),
            "reasoning": "Evaluation inconclusive"
        }


# ---------------------------------------------------------------------
# Stage 4: Verdict Quality Validation
# ---------------------------------------------------------------------

VERDICT_JUDGE_PROMPT = """You are evaluating the quality of a final verdict generated from disclosure changes.

**Detected Changes Summary**:
{changes_summary}

**Generated Verdict**:
- Final Signal: {final_signal}
- Insights: {insights}
- Verdict: {verdict}

**Evaluation Criteria**:
1. **Coherence**: Does the verdict align with the individual changes detected?
2. **Insight Quality**: Are the insights meaningful and actionable?
3. **Signal Alignment**: Does the final signal (Positive/Negative/Noise) match the overall pattern of changes?

**Output JSON**:
{{
  "coherence_score": 0-100,
  "insight_quality_score": 0-100,
  "signal_alignment_score": 0-100,
  "overall_verdict_quality": 0-100,
  "issues": ["specific quality issues"],
  "reasoning": "explanation"
}}
"""


def validate_verdict(
    verdict: Dict,
    all_changes: List[Dict],
    llm: ChatGoogleGenerativeAI
) -> Dict:
    """
    Validate the quality and coherence of the final verdict.
    
    Args:
        verdict: Dict with keys: final_signal, insights, verdict
        all_changes: List of all detected changes
    
    Returns:
        {
            "coherence_score": 0-100,
            "insight_quality_score": 0-100,
            "signal_alignment_score": 0-100,
            "overall_verdict_quality": 0-100,
            "issues": List[str],
            "reasoning": str
        }
    """
    # Summarize changes for context
    changes_summary = "\n".join([
        f"- [{c.get('Section')}] {c.get('Description')} (Signal: {c.get('Signal')})"
        for c in all_changes[:10]  # Top 10 changes
    ])
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are evaluating the quality of synthesized investment verdicts."),
        ("human", VERDICT_JUDGE_PROMPT)
    ])
    
    chain = prompt | llm
    response = chain.invoke({
        "changes_summary": changes_summary,
        "final_signal": verdict.get("final_signal", "Unknown"),
        "insights": verdict.get("insights", ""),
        "verdict": verdict.get("verdict", "")
    })
    
    content = response.content if hasattr(response, "content") else str(response)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    
    if match:
        return json.loads(match.group(0))
    else:
        logger.warning("Failed to parse verdict validation response")
        return {
            "coherence_score": 70,
            "insight_quality_score": 70,
            "signal_alignment_score": 70,
            "overall_verdict_quality": 70,
            "issues": ["Could not parse judge response"],
            "reasoning": "Evaluation inconclusive"
        }


# ---------------------------------------------------------------------
# Full Pipeline Evaluation
# ---------------------------------------------------------------------

def run_full_evaluation(
    parsed_data: Dict,
    analysis_results: List[Dict],
    verdict: Optional[Dict]
) -> Dict:
    """
    Run complete evaluation across all 4 stages IN PARALLEL.
    
    Args:
        parsed_data: Raw parsed data from PDFs (for extraction validation)
        analysis_results: List of detected changes (for change/signal validation)
        verdict: Final verdict dict (for verdict validation)
    
    Returns:
        Comprehensive evaluation report with scores and flagged issues
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    logger.info("\n" + "="*60)
    logger.info("JUDGE LLM EVALUATION STARTED")
    logger.info("="*60)
    
    llm = create_judge_llm()
    evaluation = {
        "extraction_validation": {},
        "change_validations": [],
        "signal_validations": [],
        "verdict_validation": {},
        "summary_scores": {}
    }
    
    # Collect ALL tasks upfront for maximum parallelism
    futures = {}
    
    with ThreadPoolExecutor(max_workers=8) as executor:
        # Stage 1: Validate Semantic Extraction
        logger.info("\n[1/4] Validating Semantic Extraction...")
        for company, quarters in parsed_data.items():
            for quarter, sections in quarters.items():
                for section_name in ["MD&A", "Risk_Factors", "Accounting"]:
                    text = sections.get(section_name, "")
                    if text and len(text) >= 100:
                        key = f"{company}_{quarter}_{section_name}"
                        future = executor.submit(validate_extraction, section_name, text, llm)
                        futures[future] = ("extraction", key)
        
        # Stage 2 & 3: Validate Changes and Signals
        logger.info("[2/4] Validating Change Detection...")
        logger.info("[3/4] Validating Signal Classification...")
        
        for i, change in enumerate(analysis_results):
            company = change.get("Company", "")
            q_prev = change.get("Quarter_Previous", "")
            q_curr = change.get("Quarter_Current", "")
            section = change.get("Section", "")
            
            text_prev = parsed_data.get(company, {}).get(q_prev, {}).get(section, "")
            text_curr = parsed_data.get(company, {}).get(q_curr, {}).get(section, "")
            
            # Submit change validation
            future_change = executor.submit(validate_change, change, text_prev, text_curr, llm)
            futures[future_change] = ("change", i, change)
            
            # Submit signal validation
            future_signal = executor.submit(validate_signal, change, llm)
            futures[future_signal] = ("signal", i, change)
        
        # Stage 4: Validate Verdict
        logger.info("[4/4] Validating Final Verdict...")
        if verdict:
            future_verdict = executor.submit(validate_verdict, verdict, analysis_results, llm)
            futures[future_verdict] = ("verdict",)
        
        # Collect all results
        extraction_scores = []
        change_scores = []
        signal_scores = []
        verdict_score = None
        
        for future in as_completed(futures):
            task_info = futures[future]
            try:
                result = future.result()
                
                if task_info[0] == "extraction":
                    key = task_info[1]
                    extraction_scores.append(result["quality_score"])
                    evaluation["extraction_validation"][key] = result
                    
                elif task_info[0] == "change":
                    change = task_info[2]
                    change_scores.append(result["overall_validity"])
                    evaluation["change_validations"].append({
                        "change": change,
                        "validation": result
                    })
                    
                elif task_info[0] == "signal":
                    change = task_info[2]
                    signal_scores.append(result["signal_correctness_score"])
                    evaluation["signal_validations"].append({
                        "change": change,
                        "validation": result
                    })
                    
                elif task_info[0] == "verdict":
                    evaluation["verdict_validation"] = result
                    verdict_score = result["overall_verdict_quality"]
                    
            except Exception as e:
                logger.warning(f"Judge evaluation task failed: {e}")
    
    # Calculate Summary Scores
    evaluation["summary_scores"] = {
        "extraction_avg": round(sum(extraction_scores) / len(extraction_scores), 1) if extraction_scores else 0,
        "change_detection_avg": round(sum(change_scores) / len(change_scores), 1) if change_scores else 0,
        "signal_classification_avg": round(sum(signal_scores) / len(signal_scores), 1) if signal_scores else 0,
        "verdict_quality": verdict_score,
        "overall_accuracy": round(
            sum(filter(None, [
                sum(extraction_scores) / len(extraction_scores) if extraction_scores else None,
                sum(change_scores) / len(change_scores) if change_scores else None,
                sum(signal_scores) / len(signal_scores) if signal_scores else None,
                verdict_score
            ])) / len([s for s in [extraction_scores, change_scores, signal_scores, verdict_score] if s]),
            1
        ) if any([extraction_scores, change_scores, signal_scores, verdict_score]) else 0
    }
    
    logger.info("\n" + "="*60)
    logger.info("EVALUATION COMPLETE")
    logger.info("="*60)
    logger.info(f"Overall Accuracy: {evaluation['summary_scores']['overall_accuracy']}%")
    logger.info(f"  - Extraction Quality: {evaluation['summary_scores']['extraction_avg']}%")
    logger.info(f"  - Change Detection: {evaluation['summary_scores']['change_detection_avg']}%")
    logger.info(f"  - Signal Classification: {evaluation['summary_scores']['signal_classification_avg']}%")
    if verdict_score:
        logger.info(f"  - Verdict Quality: {verdict_score}%")
    logger.info("="*60 + "\n")
    
    return evaluation
