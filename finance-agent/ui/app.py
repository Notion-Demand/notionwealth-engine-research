import streamlit as st
import sys
import os
import json
import asyncio
import tempfile
import pandas as pd

import importlib
import inspect

# Add project root to path
sys.path.append(os.getcwd())

# Multi-Agent Analysis Pipeline
try:
    from multiagent_analysis.pipeline import run_pipeline as run_multiagent_pipeline
except ImportError:
    run_multiagent_pipeline = None

# Original Agents
from control.control_plane import run_research_task
from control.research_replay import list_research_sessions, replay_research
from agents.portfolio_agent import analyze_portfolio
from agents.capital_allocation_agent import model_capital_allocation
from agents.investment_memo_agent import generate_investment_memo
from agents.risk_agent import analyze_risks
from agents.competitive_agent import analyze_competition

st.set_page_config(page_title="Financial Decision Engine", layout="wide")

# CSS: prevent metric delta text from being truncated with ellipsis
st.markdown("""
<style>
[data-testid="stMetricDelta"] > div {
    overflow: visible !important;
    white-space: normal !important;
    text-overflow: unset !important;
    max-width: none !important;
}
[data-testid="stMetricDelta"] {
    overflow: visible !important;
}
</style>
""", unsafe_allow_html=True)

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
    st.header("📊 Multi-Agent Disclosure Analysis")
    st.info("Runs 4 specialized AI agents in parallel to extract granular, sub-topic insights and detect semantic shifts between quarters.")

    if run_multiagent_pipeline is None:
        st.error("Multi-Agent Pipeline not available. Check imports.")
        st.stop()

    # Import parser utilities
    from multiagent_analysis.parser import extract_ticker_from_query, discover_pdfs, list_available_companies

    # Show available companies
    available = list_available_companies()
    available_str = ", ".join(available) if available else "None found"

    query = st.text_input(
        "Analysis Query",
        "Analyze Bharti Airtel for latest disclosure changes",
        help=f"Available companies: {available_str}"
    )

    if st.button("🚀 Run Multi-Agent Analysis", type="primary"):
        # Extract ticker from query
        ticker = extract_ticker_from_query(query)
        if not ticker:
            st.error(f"Could not identify a company from your query. Available: {available_str}")
            st.stop()

        # Discover PDFs
        try:
            q_prev_path, q_curr_path = discover_pdfs(ticker)
        except (ValueError, FileNotFoundError) as e:
            st.error(str(e))
            st.stop()

        # Show what we're analyzing
        from pathlib import Path
        st.caption(f"📁 Found: **{Path(q_prev_path).name}** → **{Path(q_curr_path).name}**")

        with st.spinner(f"Running 8 agents in parallel on {ticker}... (~25s)"):
            try:
                payload = asyncio.run(run_multiagent_pipeline(q_prev_path, q_curr_path))
            except Exception as e:
                st.error(f"Pipeline error: {str(e)}")
                st.exception(e)
                st.stop()

        st.success("✅ Analysis Complete!")

        # Save payload for quick re-render
        st.session_state["dashboard_payload"] = payload

    # Render dashboard (from session state so it persists)
    payload = st.session_state.get("dashboard_payload")
    if payload:
        # --- Header Section ---
        st.markdown("---")
        company = payload["company_ticker"]
        q_curr = payload["quarter"]
        q_prev = payload["quarter_previous"]
        signal = payload["overall_signal"]
        evasiveness = payload["executive_evasiveness_score"]

        signal_colors = {"Positive": "🟢", "Negative": "🔴", "Mixed": "🟡", "Noise": "⚪"}
        signal_icon = signal_colors.get(signal, "⚪")

        st.markdown(f"## {company} — {q_prev} → {q_curr}")

        overall_score = payload.get("overall_score", 0.0)
        validation_pct = payload.get("validation_score", 100.0)
        flagged_n = payload.get("flagged_count", 0)
        market_align = payload.get("market_alignment_pct", 0.0)
        stock_chg = payload.get("stock_price_change", 0.0)

        # Row 1: Core metrics
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Overall Signal", f"{signal_icon} {signal}")
        col2.metric("Overall Score", f"{overall_score:+.1f}", delta=f"{overall_score:+.1f}")
        col3.metric("Evasiveness", f"{evasiveness}/10")
        col4.metric("Sections", f"{len(payload['insights'])}")

        # Row 2: Validation metrics
        col5, col6, col7 = st.columns(3)
        val_icon = "✅" if validation_pct >= 80 else "⚠️" if validation_pct >= 50 else "🚫"
        col5.metric("Fact Validation", f"{val_icon} {validation_pct:.0f}%", delta=f"{flagged_n} flagged")
        mkt_icon = "🟢" if market_align >= 70 else "🟡" if market_align >= 40 else "🔴"
        col6.metric("Market Alignment", f"{mkt_icon} {market_align:.0f}%")
        stock_icon = "📈" if stock_chg > 0 else "📉" if stock_chg < 0 else "➡️"
        col7.metric("Stock Movement", f"{stock_icon} {stock_chg:+.1f}%", delta=f"{stock_chg:+.1f}%")

        st.markdown(f"**Summary:** {payload['summary']}")
        st.markdown("---")

        # --- Sectional Insights ---
        for insight in payload["insights"]:
            section = insight["section_name"]
            st.subheader(f"📋 {section}")

            # Key takeaways
            with st.expander(f"Key Takeaways — {section}", expanded=False):
                for t in insight["key_takeaways"]:
                    st.markdown(f"• {t}")

            # Metric Deltas — rendered by ui_component_type
            for metric in insight["metrics"]:
                ui_type = metric["ui_component_type"]
                signal_cls = metric["signal_classification"]
                subtitle = metric["subtopic"]
                val_status = metric.get("validation_status", "verified")
                val_note = metric.get("validation_note", "")
                mkt_status = metric.get("market_validation", "unclear")
                mkt_note = metric.get("market_note", "")

                # Skip removed metrics in main view
                if val_status == "removed":
                    continue

                # Badges
                val_badge = "⚠️ " if val_status == "flagged" else ""
                mkt_badge_map = {"aligned": "🟢", "divergent": "🔴", "unclear": "⚪"}
                mkt_badge = mkt_badge_map.get(mkt_status, "⚪")

                if ui_type == "metric_card":
                    score = metric.get("signal_score", 0)
                    delta_color = "normal" if signal_cls == "Positive" else "inverse" if signal_cls == "Negative" else "off"
                    st.metric(
                        label=f"{val_badge}{mkt_badge} {subtitle}",
                        value=f"{score:+.1f}",
                        delta=metric["language_shift"],
                        delta_color=delta_color
                    )
                    if val_status == "flagged" and val_note:
                        st.warning(f"⚠️ Fact Check: {val_note}")
                    if mkt_status == "divergent" and mkt_note:
                        st.error(f"🔴 Market Divergence: {mkt_note}")
                    elif mkt_note:
                        st.caption(f"{mkt_badge} Market: {mkt_note}")

                elif ui_type == "status_warning":
                    msg = f"**{val_badge}{mkt_badge} {subtitle}**: {metric['language_shift']}"
                    if signal_cls == "Negative":
                        st.error(msg)
                    else:
                        st.warning(msg)
                    if val_status == "flagged" and val_note:
                        st.caption(f"⚠️ Fact Check: {val_note}")
                    if mkt_note:
                        st.caption(f"{mkt_badge} Market: {mkt_note}")

                elif ui_type == "quote_expander":
                    score = metric.get("signal_score", 0)
                    with st.expander(f"{val_badge}{mkt_badge} 💬 {subtitle} ({score:+.1f}) — {metric['language_shift']}"):
                        col_q1, col_q2 = st.columns(2)
                        with col_q1:
                            st.markdown(f"**{q_prev}:**")
                            st.caption(metric["quote_old"])
                        with col_q2:
                            st.markdown(f"**{q_curr}:**")
                            st.caption(metric["quote_new"])
                        badge_color = "green" if signal_cls == "Positive" else "red" if signal_cls == "Negative" else "gray"
                        st.markdown(f"Signal: :{badge_color}[{signal_cls}] | Score: **{score:+.1f}**")
                        if val_status == "flagged" and val_note:
                            st.warning(f"⚠️ Fact Check: {val_note}")
                        if mkt_note:
                            st.info(f"{mkt_badge} Market: {mkt_note}")

            st.markdown("---")

        # --- Market Sources ---
        market_sources = payload.get("market_sources", [])
        if market_sources:
            with st.expander("🌐 Market Evidence Sources"):
                for i, url in enumerate(market_sources[:10], 1):
                    st.markdown(f"{i}. [{url}]({url})")

        # --- Raw JSON Payload ---
        with st.expander("🔍 View Raw JSON Payload"):
            st.json(payload)

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
