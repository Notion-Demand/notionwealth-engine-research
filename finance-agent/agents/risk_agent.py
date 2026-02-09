from core.financial_memory import load_facts, get_facts_for_companies
from core.entity_extraction import extract_companies
from tools.retrieve import search_financials
from vertex import call_gemini
import json

def parse_value(val_str: str) -> float:
    """Helper to parse currency strings to float."""
    try:
        clean = val_str.replace('$', '').replace(',', '').replace('%', '').strip()
        return float(clean)
    except ValueError:
        return 0.0

def detect_anomalies(facts: list[dict]) -> list[str]:
    """
    Analyze facts for significant changes or drops.
    Returns a list of text descriptions of anomalies.
    """
    anomalies = []

    # Group by metric and company
    history = {}

    for fact in facts:
        key = (fact.get("company", "Unknown"), fact.get("metric", "Unknown"))
        if key not in history:
            history[key] = {}
        year = str(fact.get("year")) if fact.get("year") is not None else "Unknown"
        history[key][year] = fact.get("value", "0")

    # Detect shifts
    for (company, metric), years in history.items():
        sorted_years = sorted(years.keys())
        if len(sorted_years) < 2:
            continue

        for i in range(len(sorted_years) - 1):
            y_prev = sorted_years[i]
            y_curr = sorted_years[i+1]

            v_prev = parse_value(years[y_prev])
            v_curr = parse_value(years[y_curr])

            if v_prev == 0: continue

            change_pct = ((v_curr - v_prev) / v_prev) * 100

            if change_pct < -5.0:
                anomalies.append(f"NEGATIVE DRIFT: {company} {metric} declined {change_pct:.1f}% from {y_prev} to {y_curr} (Value: {v_curr} vs {v_prev})")
            elif change_pct > 20.0:
                 anomalies.append(f"SPIKE: {company} {metric} jumped {change_pct:.1f}% from {y_prev} to {y_curr} (Value: {v_curr} vs {v_prev})")

    return anomalies

def analyze_risks(task: str) -> str:
    """
    Identify financial risks and anomalies.
    """
    # 1. Structure Analysis (filtered by company)
    companies = extract_companies(task)
    if companies:
        facts = get_facts_for_companies(companies)
    else:
        facts = load_facts()
    anomalies = detect_anomalies(facts)
    anomaly_text = "\n".join(anomalies) if anomalies else "No significant numerical anomalies detected in stored facts."

    # 2. Risk Search
    search_query = f"{task} risk factors challenges uncertainties competition regulation"
    search_results = search_financials(search_query, k=5)

    text_context = ""
    for res in search_results:
        text = res.get('text', '')[:2000]
        text_context += f"Source: {res.get('source', 'Unknown')}\nContent: {text}\n---\n"

    # 3. LLM Synthesis
    prompt = f"""
    You are a Risk Management Specialist.
    Analyze the provided data to identify emerging risks and financial anomalies.

    DETECTED ANOMALIES (from structured data):
    {anomaly_text}

    RISK FACTORS (from text search):
    {text_context}

    USER TASK: {task}

    OUTPUT FORMAT:
    1. Financial Anomalies (Explain the detected numerical shifts)
    2. Key Risk Factors (Synthesize from text: regulatory, market, operational)
    3. Emerging Threats (What is new or growing?)
    4. Conclusion (Risk outlook)

    Cite sources.
    """

    return call_gemini(prompt)
