import streamlit as st
import sys
import os
import json
import pandas as pd

# Add project root to path
sys.path.append(os.getcwd())

from control.control_plane import run_research_task
from control.research_replay import list_research_sessions, replay_research
from agents.portfolio_agent import analyze_portfolio
from agents.capital_allocation_agent import model_capital_allocation
from agents.investment_memo_agent import generate_investment_memo
from agents.risk_agent import analyze_risks
from agents.competitive_agent import analyze_competition

st.set_page_config(page_title="Financial Decision Engine", layout="wide")

st.title("Financial Agent Decision Engine")

# Sidebar
mode = st.sidebar.radio(
    "Select Mode",
    ["Deep Research", "Risk Assessment", "Competitive Analysis", "Portfolio Strategy", "Capital Modeling", "Investment Memo", "History & Replay"]
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
            st.markdown(report)

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
