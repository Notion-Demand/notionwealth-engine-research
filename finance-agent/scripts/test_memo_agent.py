import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from agents.investment_memo_agent import generate_investment_memo

def main():
    task = "Apple long-term revenue growth and services outlook"
    print(f"Generating Investment Memo for: {task}\n" + "="*60)
    
    memo = generate_investment_memo(task)
    
    print("\n--- GENERATED MEMO ---\n")
    print(memo)
    
    # Save to file for inspection
    os.makedirs("data/processed", exist_ok=True)
    with open("data/processed/latest_memo.md", "w") as f:
        f.write(memo)
    print("\n[Saved to data/processed/latest_memo.md]")

if __name__ == "__main__":
    main()
