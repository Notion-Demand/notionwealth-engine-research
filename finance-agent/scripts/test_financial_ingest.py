import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from tools.ingest import ingest_financials
from core.financial_memory import load_facts

def main():
    print("Starting structured ingestion test...")
    
    # Run ingestion
    result = ingest_financials("data/raw")
    print(result)
    
    # Check memory
    facts = load_facts()
    print("\n--- Extracted Facts ---")
    print(f"Total facts stored: {len(facts)}")
    
    for fact in facts[:5]: # Print first 5 facts
        print(fact)
        
    if len(facts) > 0:
        print("\nTest PASSED: Facts extracted and stored.")
    else:
        print("\nTest FAILED: No facts found.")

if __name__ == "__main__":
    main()
