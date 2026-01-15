import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from agents.risk_agent import analyze_risks

def main():
    task = "Apple long-term risks and emerging financial anomalies"
    print(f"Running Risk Analysis for: {task}\n" + "="*60)
    
    report = analyze_risks(task)
    
    print("\n--- RISK REPORT ---\n")
    print(report)

if __name__ == "__main__":
    main()
