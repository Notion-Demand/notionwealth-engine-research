import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from agents.capital_allocation_agent import model_capital_allocation

def main():
    task = "Capital outlook for Apple given services growth and China risk"
    print(f"Running Capital Allocation Modeling for: {task}\n" + "="*60)
    
    report = model_capital_allocation(task)
    
    print("\n--- CAPITAL STRATEGY REPORT ---\n")
    print(report)

if __name__ == "__main__":
    main()
