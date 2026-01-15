import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from agents.portfolio_agent import analyze_portfolio

def main():
    task = "Portfolio view of Apple and Microsoft given cloud growth and regulatory risks"
    print(f"Running Portfolio Analysis for: {task}\n" + "="*60)
    
    report = analyze_portfolio(task)
    
    print("\n--- PORTFOLIO STRATEGY REPORT ---\n")
    print(report)

if __name__ == "__main__":
    main()
