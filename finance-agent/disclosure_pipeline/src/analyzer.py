"""
LLM-based disclosure change analysis using Google Gemini.
Generalized, regime-aware, and signal-safe.
"""

import os
import logging
import re
import json
from typing import List, Dict, Optional, Tuple
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

from .models import DisclosureChange, SignalClassification

# ---------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------
# Concept Regimes (GENERAL, COMPANY-AGNOSTIC)
# ---------------------------------------------------------------------

ACCOUNTING_KEYWORDS = {
    "model", "policy", "provision", "impairment", "recognition",
    "pd", "lgd", "ead", "amortization", "depreciation",
    "expected credit loss", "ecl", "methodology"
}

GUIDANCE_KEYWORDS = {
    "expect", "estimate", "guidance", "outlook",
    "forecast", "we believe", "target", "corridor"
}

ONE_TIME_KEYWORDS = {
    "one-time", "exceptional", "annual exercise",
    "court order", "ipo", "spin-off", "divestment",
    "tax reversal", "model refresh"
}


def detect_regime(text: str) -> str:
    t = text.lower()

    if any(k in t for k in ACCOUNTING_KEYWORDS):
        return "ACCOUNTING"

    if any(k in t for k in ONE_TIME_KEYWORDS):
        return "ONE_TIME"

    if any(k in t for k in GUIDANCE_KEYWORDS):
        return "GUIDANCE"

    return "OPERATING"


def is_comparable(quote_old: str, quote_new: str) -> bool:
    """
    Enforce same-regime comparison.
    """
    return detect_regime(quote_old) == detect_regime(quote_new)


def downgrade_signal(signal: SignalClassification, quote_new: str) -> SignalClassification:
    """
    Prevent one-time or model-driven events from becoming trend signals.
    """
    if any(k in quote_new.lower() for k in ONE_TIME_KEYWORDS):
        return SignalClassification.NOISE
    return signal


# ---------------------------------------------------------------------
# System Prompt (MINIMALLY MODIFIED, GENERAL)
# ---------------------------------------------------------------------

SYSTEM_PROMPT = """You are a financial disclosure analyst detecting meaningful changes between quarterly filings.

RULES:
1. Ignore boilerplate, formatting, and repeated tables.
2. Detect language shifts (e.g., "temporary" → "structural").
3. Detect new specificity (vague → quantified or named drivers).
4. Detect accounting policy or methodology changes.

IMPORTANT COMPARABILITY RULE:
Only flag changes where the OLD and NEW quotes refer to the SAME type of concept.
Do NOT compare operating commentary to accounting methodology changes.

SIGNAL RULES:
- Positive: Structural improvements or durable risk reduction.
- Negative: Structural deterioration or newly revealed risk.
- Noise: One-time, compliance-driven, or purely explanatory changes.

OUTPUT:
Return ONLY valid JSON.
0–5 changes per section.
Quotes must be verbatim.
"""


# ---------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------

def create_gemini_llm(temperature: float = 0.1) -> ChatGoogleGenerativeAI:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not found")

    return ChatGoogleGenerativeAI(
        model="gemini-1.5-flash",
        temperature=temperature,
        google_api_key=api_key,
        convert_system_message_to_human=True
    )


# ---------------------------------------------------------------------
# Core Comparison
# ---------------------------------------------------------------------

def compare_sections(
    section_name: str,
    text_previous: Optional[str],
    text_current: Optional[str],
    llm: ChatGoogleGenerativeAI
) -> Tuple[List[DisclosureChange], Dict]:
    """
    Returns (List of changes, usage_metadata)
    """
    if not text_previous or not text_current:
        return [], {}

    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", """Compare these two versions of the {section} section.

PREVIOUS:
{text_old}

CURRENT:
{text_new}

Return JSON:
{{
  "changes": [
    {{
      "section": "{section}",
      "quote_old": "...",
      "quote_new": "...",
      "description_of_change": "...",
      "signal_classification": "Positive" | "Negative" | "Noise"
    }}
  ]
}}
""")
    ])

    chain = prompt | llm
    response = chain.invoke({
        "section": section_name,
        "text_old": text_previous[:10000],
        "text_new": text_current[:10000]
    })

    usage = getattr(response, "usage_metadata", {})
    content = response.content if hasattr(response, "content") else str(response)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    parsed = json.loads(match.group(0)) if match else {"changes": []}

    results: List[DisclosureChange] = []
    seen_new = set()
    seen_desc = set()

    for ch in parsed.get("changes", []):
        quote_old = ch.get("quote_old", "").strip()
        quote_new = ch.get("quote_new", "").strip()
        desc = ch.get("description_of_change", "").strip()
        signal_val = ch.get("signal_classification", "Noise")
        
        try:
            signal = SignalClassification(signal_val)
        except ValueError:
            signal = SignalClassification.NOISE

        if not quote_old or not quote_new:
            continue

        # 🔒 Regime comparability gate
        if not is_comparable(quote_old, quote_new):
            continue

        # 🔒 Dedup
        if quote_new.lower() in seen_new or desc.lower() in seen_desc:
            continue

        # 🔒 Signal downgrading
        signal = downgrade_signal(signal, quote_new)

        seen_new.add(quote_new.lower())
        seen_desc.add(desc.lower())

        results.append(
            DisclosureChange(
                section=section_name,
                quote_old=quote_old,
                quote_new=quote_new,
                description_of_change=desc,
                signal_classification=signal
            )
        )

    return results, usage


# ---------------------------------------------------------------------
# Quarter Comparison
# ---------------------------------------------------------------------

def compare_quarters(
    company: str,
    quarter_current: str,
    quarter_previous: str,
    data_current: Dict[str, Optional[str]],
    data_previous: Dict[str, Optional[str]],
    llm: ChatGoogleGenerativeAI
) -> Tuple[List[DisclosureChange], Dict]:
    """
    Returns (List of changes, aggregate usage_metadata)
    """
    all_changes: List[DisclosureChange] = []
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    for section in ["MD&A", "Risk_Factors", "Accounting"]:
        changes, usage = compare_sections(
            section,
            data_previous.get(section),
            data_current.get(section),
            llm
        )
        all_changes.extend(changes)
        
        # Accumulate usage
        if usage:
            total_usage["input_tokens"] += usage.get("input_tokens", 0)
            total_usage["output_tokens"] += usage.get("output_tokens", 0)
            total_usage["total_tokens"] += usage.get("total_tokens", 0)

    return all_changes, total_usage


# ---------------------------------------------------------------------
# Final Verdict Generation
# ---------------------------------------------------------------------

def generate_final_verdict(results: List[Dict], llm: ChatGoogleGenerativeAI) -> Tuple[Dict, Dict]:
    """
    Synthesizes the set of changes into a natural language verdict and a final signal.
    """
    if not results:
        return {
            "verdict": "No meaningful changes detected to analyze.",
            "final_signal": "Noise"
        }, {}

    # Format the changes for the prompt
    formatted_changes = []
    for i, res in enumerate(results):
        formatted_changes.append(
            f"{i+1}. [{res['Section']}] {res['Description']} (Signal: {res['Signal']})\n"
            f"   ' {res['Quote_New']} '"
        )
    
    changes_text = "\n\n".join(formatted_changes)

    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a senior investment strategist and credit analyst. 
Your task is to review a list of quarterly disclosure changes and provide a final synthesis.

Identify the most impactful shifts, ignore the noise, and provide a clear outlook on the company's trajectory.
"""),
        ("human", """Review these detected changes in quarterly filings for {company} ({prev_q} -> {curr_q}):

{changes}

Based on these changes, provide:
1. **Insights & Highlights**: A concise summary of the most important structural shifts and risks.
2. **Final Verdict**: A clear natural language interpretation of what this means for the company's future.
3. **Sentiment Signal**: A single label ('Positive', 'Negative', or 'Noise').

Return JSON with keys: 'insights', 'verdict', 'final_signal'.""")
    ])

    chain = prompt | llm
    
    # We use the first result to get company/quarter info for the prompt
    sample = results[0]
    
    response = chain.invoke({
        "company": sample["Company"],
        "prev_q": sample["Quarter_Previous"],
        "curr_q": sample["Quarter_Current"],
        "changes": changes_text[:20000] # Safety truncate
    })

    usage = getattr(response, "usage_metadata", {})
    content = response.content if hasattr(response, "content") else str(response)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    parsed = json.loads(match.group(0)) if match else {
        "insights": "Error parsing LLM response",
        "verdict": content,
        "final_signal": "Noise"
    }

    return parsed, usage


# ---------------------------------------------------------------------
# Multi-Company Analysis
# ---------------------------------------------------------------------

def analyze_all_companies(parsed_data: Dict, dry_run: bool = False) -> Tuple[List[Dict], Dict]:
    """
    Returns (List of changes, aggregate usage_metadata)
    """
    llm = None if dry_run else create_gemini_llm()
    results = []
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    for company, quarters_data in parsed_data.items():
        # Sort quarters chronologically
        quarters = sorted(quarters_data.keys(), key=lambda q: (q.split('_')[1], q.split('_')[0]) if '_' in q else q)

        for i in range(1, len(quarters)):
            q_prev, q_curr = quarters[i - 1], quarters[i]

            if dry_run:
                continue

            changes, usage = compare_quarters(
                company,
                q_curr,
                q_prev,
                quarters_data[q_curr],
                quarters_data[q_prev],
                llm
            )

            # Accumulate usage
            total_usage["input_tokens"] += usage.get("input_tokens", 0)
            total_usage["output_tokens"] += usage.get("output_tokens", 0)
            total_usage["total_tokens"] += usage.get("total_tokens", 0)

            for c in changes:
                results.append({
                    "Company": company,
                    "Quarter_Previous": q_prev,
                    "Quarter_Current": q_curr,
                    "Section": c.section,
                    "Quote_Old": c.quote_old,
                    "Quote_New": c.quote_new,
                    "Description": c.description_of_change,
                    "Signal": c.signal_classification.value
                })

    # Global dedup
    final = []
    seen = set()
    for r in results:
        key = (r["Company"].lower(), r["Quarter_Current"], r["Quote_New"].lower())
        if key not in seen:
            seen.add(key)
            final.append(r)

    # Generate Final Verdicts for each company/quarter pair
    # For now, let's just do it for the main company being analyzed
    if final and not dry_run:
        logger.info("Generating final synthesis and verdict...")
        verdict, v_usage = generate_final_verdict(final, llm)
        
        # Accumulate usage
        total_usage["input_tokens"] += v_usage.get("input_tokens", 0)
        total_usage["output_tokens"] += v_usage.get("output_tokens", 0)
        total_usage["total_tokens"] += v_usage.get("total_tokens", 0)
        
        # We'll attach the verdict to a special return format or log it
        final_summary = {
            "results": final,
            "verdict": verdict
        }
        return final_summary, total_usage

    return {"results": final, "verdict": None}, total_usage


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

if __name__ == "__main__":
    with open("output/parsed_data.json") as f:
        data = json.load(f)

    out_data, usage = analyze_all_companies(data, dry_run=True)
    print(f"Detected {len(out_data['results'])} changes")
