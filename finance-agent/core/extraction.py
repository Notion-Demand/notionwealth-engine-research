import json
import re
from vertex import call_gemini

def extract_financials(text_chunk: str, source_file: str) -> list[dict]:
    """
    Extract structured financial facts from a text chunk using Gemini.
    """
    prompt = f"""
    You are a financial analyst extraction bot.
    Analyze the following text text from document '{source_file}'.
    Identify if it contains key financial metrics (Revenue, Net Income, Operating Groups, etc.) or specific financial statements.
    
    If meaningful financial facts are found, extract them into a JSON list of objects.
    Each object must have:
    - "company": (inferred from context or 'Unknown')
    - "year": (the fiscal year or period, e.g., '2023', '2024')
    - "metric": (e.g., 'Net Sales', 'Operating Income')
    - "value": (the numerical value as a string, e.g., '$85,000 million')
    - "evidence": (a short snippet of text proving this fact)
    
    If no clear financial facts are found, return an empty list: []
    
    IMPORTANT: Return ONLY valid JSON. No markdown formatting.
    
    Text Chunk:
    {text_chunk[:4000]} 
    """
    
    try:
        response = call_gemini(prompt)
        
        # Clean up code blocks if present
        clean_response = response.strip()
        if clean_response.startswith("```json"):
            clean_response = clean_response[7:]
        if clean_response.endswith("```"):
            clean_response = clean_response[:-3]
            
        facts = json.loads(clean_response)
        
        # Validate and inject source file
        valid_facts = []
        if isinstance(facts, list):
            for fact in facts:
                if isinstance(fact, dict) and "metric" in fact and "value" in fact:
                    fact["source_file"] = source_file
                    valid_facts.append(fact)
                    
        return valid_facts
        
    except Exception as e:
        print(f"Extraction error: {e}")
        return []
