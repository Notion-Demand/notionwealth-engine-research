import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from agents.financial_agent import analyze_financials

def main():
    query = "Analyze Apple's revenue and services growth trends in 2025 vs 2024"
    print(f"Running Analysis for: {query}\n" + "="*60)
    
    response = analyze_financials(query)
    
    print("\nAGENT RESPONSE:\n")
    print(response)

if __name__ == "__main__":
    main()
