from core.financial_memory import load_facts, get_facts_for_companies, compact_facts
from core.entity_extraction import extract_companies
from tools.retrieve import search_financials
from vertex import call_gemini
import json

def analyze_competition(task: str) -> str:
    """
    Perform a competitive analysis comparing multiple companies.
    """
    # 1. Get relevant facts (filtered by companies in query)
    companies = extract_companies(task)
    if companies:
        facts = get_facts_for_companies(companies)
    else:
        facts = load_facts()[:300]
    facts = facts[:500]
    facts_context = compact_facts(facts)

    # 2. Vector Search for Strategic Context
    search_query = f"{task} competitive strategy market share positioning vs peers"
    search_results = search_financials(search_query, k=10)

    text_context = ""
    for res in search_results:
        text = res.get('text', '')[:2000]
        text_context += f"Source: {res.get('source', 'Unknown')}\nContent: {text}\n---\n"

    # 3. LLM Synthesis
    prompt = f"""
    You are a Competitive Intelligence Analyst.
    Perform a comparative analysis based on the user's task.

    USER TASK: {task}

    AVAILABLE STRUCTURED METRICS:
    {facts_context}

    QUALITATIVE CONTEXT (Search Results):
    {text_context}

    INSTRUCTIONS:
    1. Identify the companies mentioned or implied in the task.
    2. Compare them using the available data.
       - If data for a company is missing in the "metrics" section, explicitly state: "Data for [Company] not available in local verified memory."
    3. Output Format:
       - **Executive Summary**: High-level comparison.
       - **Metric Comparison Table**: Columns for Company, Metric, Value, Year.
       - **Strategic Positioning**: Narrative comparison of strengths/weaknesses.
       - **Risks vs Peers**: Where is each company vulnerable?
    4. Cite sources (filenames) for all data points.
    """

    return call_gemini(prompt)
