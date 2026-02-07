from core.financial_memory import load_facts, get_facts_for_companies, compact_facts
from core.entity_extraction import extract_companies
from tools.retrieve import search_financials
from vertex import call_gemini
import json

def analyze_financials(query: str) -> str:
    """
    Analyze financial data to answer a query.
    Combines structured facts and text search results.
    """
    # 1. Retrieve Structured Facts (filtered by company)
    companies = extract_companies(query)
    if companies:
        facts = get_facts_for_companies(companies)
    else:
        facts = load_facts()[:200]
    facts = facts[:500]
    facts_context = compact_facts(facts)

    # 2. Retrieve Unstructured Text
    search_results = search_financials(query, k=5)
    text_context = ""
    for res in search_results:
        text = res.get('text', '')[:2000]
        text_context += f"Source: {res.get('source', 'Unknown')}\nContent: {text}\n---\n"

    # 3. Synthesize with LLM
    prompt = f"""
    You are a senior financial analyst. Answer the user's query based on the provided data.

    Data Sources:
    1. STRUCTURED FACTS (High precision numbers):
    {facts_context}

    2. TEXT SEARCH RESULTS (Context and explanations):
    {text_context}

    Query: {query}

    Instructions:
    - Use the STRUCTURED FACTS for specific numbers (Revenue, Net Income, etc.) to ensure accuracy.
    - Use the TEXT SEARCH RESULTS to explain trends, reasons, and provide qualitative context.
    - Cite your sources (e.g., [Source: _10-K...]).
    - If data is conflicting, prioritize the STRUCTURED FACTS for numbers.
    - Provide a professional, comprehensive answer.
    """

    return call_gemini(prompt)
