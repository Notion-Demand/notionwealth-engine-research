from concurrent.futures import ThreadPoolExecutor
from control.control_plane import run_research_task
from agents.risk_agent import analyze_risks
from agents.competitive_agent import analyze_competition
from vertex import call_gemini
import json

def model_capital_allocation(task: str) -> str:
    """
    Synthesize a Capital Allocation Strategy by orchestrating
    Research, Risk, and Competitive agents in parallel.
    """

    # 1. Gather Intelligence (Parallel Execution)
    print(f"  [Capital Agent] Running Research + Risk + Competition in parallel for: {task}")
    with ThreadPoolExecutor(max_workers=3) as executor:
        future_research = executor.submit(run_research_task, task)
        future_risk = executor.submit(analyze_risks, task)
        future_comp = executor.submit(analyze_competition, task)

        research_json = future_research.result()
        risk_report = future_risk.result()
        comp_report = future_comp.result()

    research_data = json.loads(research_json)
    research_analysis = research_data.get("final_result", "")

    # 2. Synthesize Strategy
    prompt = f"""
    You are a Chief Investment Officer (CIO) / Portfolio Manager.
    Develop a Capital Allocation Strategy based on the following intelligence reports.

    USER TASK: {task}

    --- INTELLIGENCE REPORTS ---

    [REPORT 1: FUNDAMENTAL RESEARCH]
    {research_analysis}

    [REPORT 2: RISK ASSESSMENT]
    {risk_report}

    [REPORT 3: COMPETITIVE LANDSCAPE]
    {comp_report}

    --- INSTRUCTIONS ---

    Synthesize these inputs into a structured Capital Deployment Framework.

    Output Format (Markdown):

    # Capital Allocation Strategy: [Company/Topic]

    ## 1. Capital Thesis
    (The core argument for how capital should be deployed - e.g., heavy R&D, dividends, M&A)

    ## 2. Scenario Modeling
    *   **Base Case**: (Most likely outcome given current trends)
    *   **Bull Case**: (Upside drivers - e.g., successful AI monetization, margin expansion)
    *   **Bear Case**: (Downside realization - e.g., regulatory crackdown, comp losses)

    ## 3. Recommended Capital Posture
    (e.g., "Overweight Investment in AI Infra", "Defensive Balance Sheet Management")

    ## 4. Key Sensitivities
    (What variables move the needle most?)

    ## 5. Diligence Questions
    (What is still unknown?)

    Cite the sources provided in the reports.
    """

    return call_gemini(prompt)
