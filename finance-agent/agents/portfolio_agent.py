from concurrent.futures import ThreadPoolExecutor
from agents.capital_allocation_agent import model_capital_allocation
from vertex import call_gemini

def analyze_portfolio(task: str) -> str:
    """
    Synthesize a Portfolio Strategy by aggregating capital allocation models
    for multiple companies in parallel.
    """

    # 1. Identify Entities (Basic Heuristic for MVP)
    known_companies = ["Apple", "Microsoft", "Google", "Alphabet", "Amazon", "Tesla", "Meta", "NVIDIA"]
    targets = [c for c in known_companies if c.lower() in task.lower()]

    if "Google" in targets and "Alphabet" not in targets:
        targets.append("Alphabet")
    if "Alphabet" in targets and "Google" not in targets:
        targets.append("Google")
    targets = list(set(targets))

    if not targets:
        return "No specific companies identified for portfolio analysis. Please name companies (e.g. Apple, Microsoft) in your query."

    print(f"  [Portfolio Agent] Identified Targets: {targets}")

    # 2. Fan-Out: Run Capital Allocation Model for ALL companies IN PARALLEL
    def run_one(company):
        sub_task = f"Capital allocation analysis for {company}. Context: {task}"
        print(f"    -> Modeling {company}...")
        return company, model_capital_allocation(sub_task)

    reports = {}
    with ThreadPoolExecutor(max_workers=len(targets)) as executor:
        futures = [executor.submit(run_one, c) for c in targets]
        for future in futures:
            company, report = future.result()
            reports[company] = report

    # 3. Fan-In: Synthesize Portfolio View
    reports_text = ""
    for company, report in reports.items():
        reports_text += f"\n--- REPORT: {company} ---\n{report}\n"

    prompt = f"""
    You are a Lead Portfolio Manager.
    Analyze the following component capital allocation reports to construct a Portfolio Strategy.

    USER TASK: {task}

    --- COMPONENT REPORTS ---
    {reports_text}

    --- INSTRUCTIONS ---

    Synthesize a top-level Portfolio Analysis.

    Output Format (Markdown):

    # Portfolio Strategy: [Topic]

    ## 1. Portfolio Overview
    (High-level thesis on the basket of companies)

    ## 2. Exposure Map
    | Company | Primary Growth Driver | Primary Risk | Capital Posture |
    | :--- | :--- | :--- | :--- |
    | [Name] | [Driver] | [Risk] | [Posture] |
    ...

    ## 3. Concentration Analysis
    (Identify overlapping risks or correlated themes across the portfolio, e.g., "High exposure to Regulatory complications in China")

    ## 4. Capital Rebalancing Themes
    (Relative trade-offs. Where is the best risk-adjusted return? e.g., "Overweight Microsoft for AI infra, Underweight Apple due to device saturation")

    ## 5. Prioritized Opportunity Set
    1. [Highest Conviction Idea]
    2. ...

    Cite evidence from the component reports.
    """

    return call_gemini(prompt)
