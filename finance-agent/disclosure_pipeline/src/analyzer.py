"""
LLM-based disclosure change analysis using Google Gemini.
Generalized, regime-aware, and signal-safe.
"""

import os
import logging
import re
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
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
        model="gemini-2.0-flash",
        temperature=temperature,
        google_api_key=api_key,
        convert_system_message_to_human=True
    )


# ---------------------------------------------------------------------
# Core Comparison
# ---------------------------------------------------------------------

MIN_SECTION_LENGTH = 100  # Skip placeholder/empty sections

def compare_sections(
    section_name: str,
    text_previous: Optional[str],
    text_current: Optional[str],
    llm: ChatGoogleGenerativeAI
) -> Tuple[List[DisclosureChange], Dict]:
    """
    Returns (List of changes, usage_metadata)
    """
    if (not text_previous or not text_current
            or len(text_previous) < MIN_SECTION_LENGTH
            or len(text_current) < MIN_SECTION_LENGTH):
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
        quote_old = (ch.get("quote_old") or "").strip()
        quote_new = (ch.get("quote_new") or "").strip()
        desc = (ch.get("description_of_change") or "").strip()
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
    Returns (List of changes, aggregate usage_metadata).
    Runs all 3 section comparisons in parallel for speed.
    """
    all_changes: List[DisclosureChange] = []
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    sections = ["MD&A", "Risk_Factors", "Accounting"]

    def compare_one(section):
        # Create a separate LLM instance per thread for safety
        section_llm = create_gemini_llm()
        return compare_sections(
            section,
            data_previous.get(section),
            data_current.get(section),
            section_llm
        )

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(compare_one, s): s for s in sections}
        for future in futures:
            changes, usage = future.result()
            all_changes.extend(changes)
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

# ---------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------

ANALYSIS_CACHE_PATH = Path("disclosure_pipeline/output/analysis_cache.json")

def load_analysis_cache() -> Dict:
    if ANALYSIS_CACHE_PATH.exists():
        try:
            with open(ANALYSIS_CACHE_PATH, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load cache: {e}")
    return {}

def save_analysis_cache(cache: Dict):
    try:
        ANALYSIS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(ANALYSIS_CACHE_PATH, 'w') as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save cache: {e}")

def get_cache_key(company: str, q_prev: str, q_curr: str, section: str) -> str:
    """Generate a unique key for the cache."""
    return f"{company}|{q_prev}|{q_curr}|{section}"


# ---------------------------------------------------------------------
# Multi-Company Analysis
# ---------------------------------------------------------------------

def _has_meaningful_data(quarter_data: Dict[str, Optional[str]]) -> bool:
    """Check if a quarter has any section with enough content to analyze."""
    return any(
        quarter_data.get(s) and len(quarter_data.get(s, "")) >= MIN_SECTION_LENGTH
        for s in ["MD&A", "Risk_Factors", "Accounting"]
    )


def analyze_all_companies(parsed_data: Dict, dry_run: bool = False) -> Tuple[List[Dict], Dict]:
    """
    Returns (analysis_summary_dict, aggregate usage_metadata).
    Quarter pairs are analyzed in parallel. Pairs with empty/placeholder
    data are skipped entirely.
    """
    from pathlib import Path

    llm = None if dry_run else create_gemini_llm()
    results = []
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    # Load cache
    cache = load_analysis_cache()
    cache_hits = 0

    # Collect all quarter pairs across all companies
    pairs_to_analyze = []

    for company, quarters_data in parsed_data.items():
        # Filter to quarters with meaningful data, then sort chronologically
        meaningful_quarters = [
            q for q in quarters_data.keys()
            if _has_meaningful_data(quarters_data[q])
        ]
        quarters = sorted(
            meaningful_quarters,
            key=lambda q: (q.split('_')[1], q.split('_')[0]) if '_' in q else q
        )

        if len(quarters) < 2:
            logger.info(f"Skipping {company}: fewer than 2 quarters with data")
            continue

        for i in range(1, len(quarters)):
            q_prev, q_curr = quarters[i - 1], quarters[i]

            if dry_run:
                continue

            # Check if all sections are cached for this pair
            sections = ["MD&A", "Risk_Factors", "Accounting"]
            cached_changes_for_pair = []
            fully_cached = True

            for section in sections:
                key = get_cache_key(company, q_prev, q_curr, section)
                if key not in cache:
                    fully_cached = False
                    break
                cached_changes_for_pair.extend(cache[key])

            if fully_cached:
                logger.info(f"Cache hit for {company} {q_prev}->{q_curr}")
                cache_hits += 1
                results.extend(cached_changes_for_pair)
                continue

            pairs_to_analyze.append((company, q_curr, q_prev, quarters_data))

    # Run uncached pairs in parallel
    if pairs_to_analyze:
        def analyze_pair(args):
            company, q_curr, q_prev, quarters_data = args
            pair_llm = create_gemini_llm()
            changes, usage = compare_quarters(
                company, q_curr, q_prev,
                quarters_data[q_curr], quarters_data[q_prev],
                pair_llm
            )
            pair_results = []
            for c in changes:
                pair_results.append({
                    "Company": company,
                    "Quarter_Previous": q_prev,
                    "Quarter_Current": q_curr,
                    "Section": c.section,
                    "Quote_Old": c.quote_old,
                    "Quote_New": c.quote_new,
                    "Description": c.description_of_change,
                    "Signal": c.signal_classification.value
                })
            return pair_results, usage

        with ThreadPoolExecutor(max_workers=len(pairs_to_analyze)) as executor:
            futures = [executor.submit(analyze_pair, p) for p in pairs_to_analyze]
            for future, (company, q_curr, q_prev, _) in zip(futures, pairs_to_analyze):
                pair_results, usage = future.result()
                results.extend(pair_results)
                total_usage["input_tokens"] += usage.get("input_tokens", 0)
                total_usage["output_tokens"] += usage.get("output_tokens", 0)
                total_usage["total_tokens"] += usage.get("total_tokens", 0)

                # Update cache
                by_section = defaultdict(list)
                for r in pair_results:
                    by_section[r["Section"]].append(r)
                for section in ["MD&A", "Risk_Factors", "Accounting"]:
                    key = get_cache_key(company, q_prev, q_curr, section)
                    cache[key] = by_section.get(section, [])

        save_analysis_cache(cache)

    # Global dedup
    final = []
    seen = set()
    for r in results:
        key = (r["Company"].lower(), r["Quarter_Current"], r["Quote_New"].lower())
        if key not in seen:
            seen.add(key)
            final.append(r)

    if cache_hits > 0:
        logger.info(f"Used cached analysis for {cache_hits} quarter pairs")

    # Generate Final Verdict
    if final and not dry_run:
        logger.info("Generating final synthesis and verdict...")
        verdict, v_usage = generate_final_verdict(final, llm)

        total_usage["input_tokens"] += v_usage.get("input_tokens", 0)
        total_usage["output_tokens"] += v_usage.get("output_tokens", 0)
        total_usage["total_tokens"] += v_usage.get("total_tokens", 0)

        return {"results": final, "verdict": verdict}, total_usage

    return {"results": final, "verdict": None}, total_usage


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

if __name__ == "__main__":
    with open("output/parsed_data.json") as f:
        data = json.load(f)

    out_data, usage = analyze_all_companies(data, dry_run=True)
    print(f"Detected {len(out_data['results'])} changes")
