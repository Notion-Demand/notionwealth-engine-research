from core.financial_memory import load_facts
from tools.retrieve import search_financials
from vertex import call_gemini
import json

def analyze_competition(task: str) -> str:
    """
    Perform a competitive analysis comparing multiple companies.
    """
    # 1. Identify Companies (Simple heuristic or LLM extraction)
    # For this MVP, we will rely on the LLM to identify relevant facts from the full dump,
    # or we could parse the query. Let's dump relevant facts.
    
    facts = load_facts()
    
    # Simple filtering: if company name is in task, include its facts
    # This is a basic optimization.
    relevant_facts = [
        f for f in facts 
        if f.get("company", "").lower() in task.lower() or "apple" in task.lower() # Always include main context if potentially relevant
    ]
    
    # If no specific companies found in facts matching task, we might just pass all facts 
    # (assuming the memory isn't huge). For now, let's pass all facts to be safe, 
    # relying on the LLM to pick the right ones.
    facts_context = json.dumps(facts, indent=2)

    # 2. Vector Search for Strategic Context
    search_query = f"{task} competitive strategy market share positioning vs peers"
    search_results = search_financials(search_query, k=10)
    
    text_context = ""
    for res in search_results:
        text_context += f"Source: {res.get('source', 'Unknown')}\nContent: {res.get('text', '')}\n---\n"
        
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
