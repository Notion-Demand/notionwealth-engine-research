import json
import os

MEMORY_PATH = "data/processed/financial_facts.json"

def load_facts() -> list[dict]:
    """Load all stored financial facts."""
    if not os.path.exists(MEMORY_PATH):
        return []
    try:
        with open(MEMORY_PATH, "r") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return []

def save_facts(facts: list[dict]):
    """Save a list of facts to the store. Appends to existing facts."""
    existing = load_facts()
    existing.extend(facts)
    
    os.makedirs(os.path.dirname(MEMORY_PATH), exist_ok=True)
    with open(MEMORY_PATH, "w") as f:
        json.dump(existing, f, indent=2)

def clear_memory():
    """Clear the memory store (useful for testing/re-ingestion)."""
    if os.path.exists(MEMORY_PATH):
        os.remove(MEMORY_PATH)
