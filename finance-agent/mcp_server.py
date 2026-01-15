from mcp.server.fastmcp import FastMCP
from tools.ingest import ingest_docs
from tools.ingest import ingest_financials
from tools.retrieve import search_financials
from tools.research import research_query
from agents.financial_agent import analyze_financials
from control.control_plane import run_research_task
from agents.investment_memo_agent import generate_investment_memo
from agents.risk_agent import analyze_risks
from agents.competitive_agent import analyze_competition
from agents.capital_allocation_agent import model_capital_allocation
from agents.portfolio_agent import analyze_portfolio
from control.research_replay import replay_research, list_research_sessions

from dotenv import load_dotenv
load_dotenv()

mcp = FastMCP("finance-research")

mcp.add_tool(ingest_docs)
mcp.add_tool(ingest_financials)
mcp.add_tool(search_financials)
mcp.add_tool(research_query)
mcp.add_tool(analyze_financials)
mcp.add_tool(run_research_task)
mcp.add_tool(generate_investment_memo)
mcp.add_tool(analyze_risks)
mcp.add_tool(analyze_competition)
mcp.add_tool(model_capital_allocation)
mcp.add_tool(analyze_portfolio)
mcp.add_tool(replay_research)
mcp.add_tool(list_research_sessions)

if __name__ == "__main__":
    mcp.run()