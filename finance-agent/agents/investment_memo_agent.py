from control.control_plane import run_research_task
from vertex import call_gemini
import json

def generate_investment_memo(task: str) -> str:
    """
    Generate a professional investment research memo based on the task.
    Uses the Control Plane to execute and verify research first.
    """
    
    # 1. Run Research via Control Plane
    # This gives us a JSON string with trace, verification, and analysis
    session_json = run_research_task(task)
    session_data = json.loads(session_json)
    
    analysis = session_data.get("final_result", "")
    verification = session_data.get("verification_report", {})
    
    # 2. Synthesize Memo with LLM
    prompt = f"""
    You are a Partner at a top-tier investment firm. 
    Write a structured Investment Memo based on the following verified research.
    
    RESEARCH ANALYSIS:
    {analysis}
    
    VERIFICATION REPORT:
    {json.dumps(verification, indent=2)}
    
    INSTRUCTIONS:
    - Format as a clean Markdown document.
    - Title: "Investment Memo: [Topic]"
    - Sections:
        1. Executive Summary (High level thesis)
        2. Business & Financial Overview (Key trends, numbers)
        3. Growth Drivers
        4. Key Risks & Uncertainties
        5. Key Figures (Create a table of the verified numbers)
        6. Diligence Flags (List any claims from the verification report that were 'Unverified')
    - Tone: Professional, objective, data-driven.
    - Cite sources where possible.
    """
    
    return call_gemini(prompt)
