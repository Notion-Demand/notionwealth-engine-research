
from tools.ingest import ingest_docs
from tools.retrieve import search_financials
import os
from dotenv import load_dotenv

def main():
    load_dotenv()
    
    # Check if index exists by checking if data/processed is empty or missing index file
    index_path = "data/processed/finance.index"
    if not os.path.exists(index_path):
        print("Index not found. Running ingestion...")
        print(ingest_docs())
    else:
        print("Index found.")

    query = "Apple revenue growth 2023"
    print(f"Searching for: {query}")
    results = search_financials(query)
    print("Results:")
    for res in results:
        print(f"Source: {res['source']}")
        print(f"Content: {res['text'][:200]}...") # Print first 200 chars
        print("-" * 40)

if __name__ == "__main__":
    main()
