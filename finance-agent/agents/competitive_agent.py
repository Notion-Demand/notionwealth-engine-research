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
       Return a valid JSON object with the following schema:
       {{
         "executive_summary": "High-level narrative comparison of the companies.",
         "comparison_table": [
           {{"Company": "Company A", "Metric": "Revenue", "Value": "10B", "Year": "2024"}},
           {{"Company": "Company B", "Metric": "Revenue", "Value": "12B", "Year": "2024"}}
         ],
         "strategic_positioning": "Narrative comparison of strengths, weaknesses, and market position.",
         "risks": [
           "Risk 1 for Company A",
           "Risk 1 for Company B"
         ]
       }}
    4. Cite sources (filenames) for all data points within the text.
    5. Return ONLY valid JSON, no markdown formatting or extra text.
    """

    response = call_gemini(prompt)
    
    # Parse JSON
    try:
        # Remove markdown code fences if present
        import re
        content = response
        json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            json_match = re.search(r'\{.*?\}', content, re.DOTALL)
            json_str = json_match.group(0) if json_match else content

        return json.loads(json_str)
    except Exception as e:
        # Fallback to returning raw text in a wrapper
        return {
            "executive_summary": "Error parsing JSON response. Raw output below.",
            "comparison_table": [],
            "strategic_positioning": str(response),
            "risks": []
        }
