import streamlit as st
import sys
import os
import json
import pandas as pd

import importlib
import inspect

# Add project root to path
sys.path.append(os.getcwd())
# Add workspace root and pipeline paths
pipeline_path = os.path.join(os.getcwd(), "disclosure_pipeline")
if pipeline_path not in sys.path:
    sys.path.append(pipeline_path)

try:
    import src.pipeline
    importlib.reload(src.pipeline)
    from src.pipeline import run_pipeline
except ImportError as e:
    # Fallback for different execution contexts
    fallback_path = os.path.join(os.getcwd(), "..", "disclosure-analysis-pipeline")
    if fallback_path not in sys.path:
        sys.path.append(fallback_path)
    try:
        import src.pipeline
        importlib.reload(src.pipeline)
        from src.pipeline import run_pipeline
    except ImportError:
        # Error handling for path issues
        st.error("Could not load Disclosure Pipeline.")
        def run_pipeline(*args, **kwargs): return {}

# Original Agents
from control.control_plane import run_research_task
from control.research_replay import list_research_sessions, replay_research
from agents.portfolio_agent import analyze_portfolio
from agents.capital_allocation_agent import model_capital_allocation
from agents.investment_memo_agent import generate_investment_memo
from agents.risk_agent import analyze_risks
from agents.competitive_agent import analyze_competition

st.set_page_config(page_title="Financial Decision Engine", layout="wide")

# Warm-up: preload heavy resources into memory on first Streamlit run
@st.cache_resource
def _warmup_resources():
    from core.vector import load as load_vector
    from core.financial_memory import load_facts
    load_vector()
    load_facts()
    return True

_warmup_resources()

st.title("Financial Agent Decision Engine")

# Sidebar
mode = st.sidebar.radio(
    "Select Mode",
    ["Deep Research",  "Disclosures Difference","Risk Assessment", "Competitive Analysis", "Portfolio Strategy", "Capital Modeling", "Investment Memo", "History & Replay"]
)

if mode == "Deep Research":
    st.header("Deep Fundamental Research")
    query = st.text_input("Research Topic", "Apple revenue growth drivers and risks")
    
    if st.button("Run Research Agent"):
        with st.spinner("Running Agents..."):
            session_json = run_research_task(query)
            session = json.loads(session_json)
            
            st.success("Research Complete")
            
            # Display Final Result
            st.subheader("Analysis")
            st.markdown(session.get("final_result", ""))
            
            # Display Verification
            st.subheader("Verification Report")
            verify = session.get("verification_report", {})
            st.metric("Trust Score", f"{verify.get('summary_score', 0):.2f}")
            
            with st.expander("View Verification Details"):
                st.json(verify)
                
            # Display Trace
            with st.expander("View Agent Trace"):
                st.json(session.get("trace", []))

elif mode == "Risk Assessment":
    st.header("Risk & Anomaly Detection")
    st.info("Detects financial anomalies and emerging risks.")
    task = st.text_input("Risk Topic", "Apple supply chain and regulatory risks")
    
    if st.button("Analyze Risks"):
        with st.spinner("Scanning for anomalies and risks..."):
            report = analyze_risks(task)
            st.markdown(report)

elif mode == "Competitive Analysis":
    st.header("Competitive Intelligence")
    st.info("Compares multiple entities using structured metrics and strategy.")
    task = st.text_input("Competitive Topic", "Compare Apple and Microsoft cloud growth")
    
    if st.button("Run Competitive Analysis"):
        with st.spinner("Comparing entities..."):
            report = analyze_competition(task)
            
            if isinstance(report, dict):
                # 1. Executive Summary
                st.subheader("Executive Summary")
                st.markdown(report.get("executive_summary", "No summary available."))
                
                # 2. Metric Comparison Table
                st.subheader("Key Metrics Comparison")
                rows = report.get("comparison_table", [])
                if rows:
                    df = pd.DataFrame(rows)
                    st.dataframe(df, use_container_width=True)
                else:
                    st.info("No structured metrics found for comparison.")
                
                # 3. Strategic Positioning
                st.subheader("Strategic Positioning")
                st.markdown(report.get("strategic_positioning", "No strategic analysis available."))
                
                # 4. Risks
                st.subheader("Risks & Vulnerabilities")
                risks = report.get("risks", [])
                if isinstance(risks, list):
                    for r in risks:
                        st.markdown(f"- {r}")
                else:
                    st.markdown(str(risks))

            else:
                # Fallback for old text format
                st.markdown(report)

elif mode == "Disclosures Difference":
    st.header("Quarterly Disclosure Analysis")
    st.info("Analyzes shifts in MD&A, Risk Factors, and Accounting policies between quarters.")
    
    query = st.text_input("Analysis Query", "Analyze BAJFINANCE for latest disclosure changes")
    run_evaluation = st.checkbox(
        "🧑‍⚖️ Run Judge LLM Evaluation (assess accuracy, slower)",
        value=False,
        help="Validates extraction quality, change detection, signal classification, and verdict quality. Adds ~10-20 seconds."
    )
    
    if st.button("Run"):
        with st.spinner("Analyzing disclosures..."):
            try:
                # Extract potential target company from query
                target_company = None
                if "analyze" in query.lower():
                    # diverse inputs: "Analyze Bajaj Finance", "Analyze BAJFINANCE for...", "Analyze Apple"
                    parts = query.split()
                    for i, p in enumerate(parts):
                        if p.lower() == "analyze" and i + 1 < len(parts):
                            # Grab the next word or two as the company name
                            target_company = parts[i+1]
                            # Heuristic: if next word is not a preposition/stopword, append it
                            if i + 2 < len(parts) and parts[i+2].lower() not in ["for", "with", "using", "to"]:
                                target_company += " " + parts[i+2]
                            break
                            
                # Use cached parsed data if available, skip slow PDF re-parsing
                import os
                parsed_exists = os.path.exists("disclosure_pipeline/output/parsed_data.json")
                summary = run_pipeline(
                    data_dir="../disclosure-analysis-pipeline/all-pdfs",
                    output_dir="disclosure_pipeline/output",
                    skip_parsing=parsed_exists,
                    target_company=target_company,
                    skip_file_output=True,
                    run_evaluation=run_evaluation
                )
                
                if summary is None:
                    st.error("Pipeline returned None. Check internal logic or filtered data.")
                    st.stop()
                    
                st.success("Analysis complete!")
            except Exception as e:
                st.error(f"Pipeline crashed with error: {str(e)}")
                st.exception(e)
                st.stop()

            verdict = summary.get("verdict")
            if verdict:
                # Signal Indicator
                signal = verdict.get("final_signal", "Noise")
                color = "green" if signal == "Positive" else "red" if signal == "Negative" else "gray"
                st.markdown(f"### Overall Sentiment: :{color}[{signal}]")
                
                # Verdict & Insights
                col1, col2 = st.columns(2)
                with col1:
                    st.subheader("Strategic Verdict")
                    st.write(verdict.get("verdict", "No verdict available."))
                
                with col2:
                    st.subheader("Insights & Highlights")
                    st.write(verdict.get("insights", "No insights available."))
            
            # Detailed Changes Table
            results = summary.get("results", [])
            if results:
                st.subheader("Detected Significant Changes")
                df = pd.DataFrame(results)
                # Keep only relevant columns for the UI
                ui_df = df[["Section", "Description", "Signal"]]
                st.table(ui_df)
            
            # Evaluation Metrics (if judge ran)
            if "evaluation" in summary:
                st.markdown("---")
                st.subheader("📊 Judge LLM Evaluation Results")
                eval_data = summary["evaluation"]
                
                # Main metrics
                col1, col2, col3, col4 = st.columns(4)
                col1.metric("Overall Accuracy", f"{eval_data.get('overall_accuracy', 0)}%")
                col2.metric("Extraction", f"{eval_data.get('extraction_avg', 0)}%")
                col3.metric("Detection", f"{eval_data.get('change_detection_avg', 0)}%")
                col4.metric("Signals", f"{eval_data.get('signal_classification_avg', 0)}%")
                
                if eval_data.get("verdict_quality"):
                    st.metric("Verdict Quality", f"{eval_data.get('verdict_quality')}%")
                
                # Link to detailed report
                st.info("📄 Detailed evaluation report saved to `disclosure_pipeline/output/evaluation_report.md`")
                
                with st.expander("View Full Evaluation Data"):
                    st.json(eval_data)

elif mode == "Portfolio Strategy":
    st.header("Portfolio Strategy & Risk")
    st.info("Aggregates deep-dives across multiple entities.")
    task = st.text_area("Portfolio Context", "Portfolio view of Apple, Microsoft, and Google given cloud growth and regulatory risks")
    
    if st.button("Analyze Portfolio"):
        with st.spinner("Running Fan-Out/Fan-In Analysis... (This may take a minute)"):
            report = analyze_portfolio(task)
            st.markdown(report)

elif mode == "Capital Modeling":
    st.header("Capital Allocation Modeler")
    st.info("Synthesizes Research, Risk, and Competition into significant capital decisions.")
    task = st.text_input("Scenario", "Capital outlook for Apple given services growth and China risk")
    
    if st.button("Model Scenarios"):
        with st.spinner("Modeling Base/Bull/Bear Cases..."):
            report = model_capital_allocation(task)
            st.markdown(report)

elif mode == "Investment Memo":
    st.header("Investment Memo Generator")
    task = st.text_input("Topic", "Write an investment memo for Microsoft")
    
    if st.button("Generate Memo"):
        with st.spinner("Drafting Memo..."):
            memo = generate_investment_memo(task)
            st.markdown(memo)

elif mode == "History & Replay":
    st.header("Session History & Audit")
    
    sessions_json = list_research_sessions()
    sessions = json.loads(sessions_json)
    
    if not sessions:
        st.warning("No sessions found.")
    else:
        # Convert to DF for nicer display
        df = pd.DataFrame(sessions)
        st.dataframe(df)
        
        selected_id = st.selectbox("Select Session ID to Replay", df["id"].tolist())
        
        if st.button("Replay & Verify Drift"):
            with st.spinner("Replaying session against current agent logic..."):
                result_json = replay_research(selected_id)
                result = json.loads(result_json)
                
                summary = result.get("replay_summary", {})
                
                col1, col2 = st.columns(2)
                col1.metric("Match Score", summary.get("match_score"))
                col2.write("**Notes:**")
                col2.write(summary.get("notes"))
                
                st.subheader("Diff Details")
                st.json(summary)
