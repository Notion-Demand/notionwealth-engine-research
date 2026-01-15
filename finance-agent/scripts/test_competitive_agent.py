import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from agents.competitive_agent import analyze_competition

def main():
    task = "Compare Apple, Microsoft, and Google cloud and services growth"
    print(f"Running Competitive Analysis for: {task}\n" + "="*60)
    
    report = analyze_competition(task)
    
    print("\n--- COMPETITIVE ANALYSIS ---\n")
    print(report)

if __name__ == "__main__":
    main()
