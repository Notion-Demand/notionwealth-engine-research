import json
import os
from collections import defaultdict

MEMORY_PATH = "data/processed/financial_facts.json"

# Module-level caches
_cached_facts = None
_company_index = None  # dict mapping canonical company -> [fact indices]

# Mapping of known company name variants to canonical names
# Built from actual data: MSFT(18759), Microsoft(12876), Alphabet Inc.(10368), etc.
COMPANY_ALIASES = {
    # Microsoft variants
    "msft": "Microsoft",
    "microsoft": "Microsoft",
    "microsoft corporation": "Microsoft",
    "microsoft corp": "Microsoft",
    # Apple variants
    "apple": "Apple",
    "apple inc.": "Apple",
    "apple inc": "Apple",
    "aapl": "Apple",
    # Alphabet/Google variants
    "alphabet": "Alphabet",
    "alphabet inc.": "Alphabet",
    "alphabet inc": "Alphabet",
    "googl": "Alphabet",
    "google": "Alphabet",
    "google cloud": "Alphabet",
    "other bets": "Alphabet",
    "verily": "Alphabet",
    "calico": "Alphabet",
    "waymo": "Alphabet",
    # Amazon variants
    "amazon": "Amazon",
    "amzn": "Amazon",
    "amazon.com": "Amazon",
    "amazon.com, inc.": "Amazon",
    "amazon web services": "Amazon",
    # Meta variants
    "meta": "Meta",
    "meta platforms, inc.": "Meta",
    "meta platforms ireland": "Meta",
    "meta platforms": "Meta",
    "facebook": "Meta",
    "facebook, inc.": "Meta",
    # Tesla
    "tesla": "Tesla",
    "tsla": "Tesla",
    # NVIDIA
    "nvidia": "NVIDIA",
    "nvda": "NVIDIA",
    # Rivian
    "rivian": "Rivian",
    "rivian automotive, inc.": "Rivian",
    # Other subsidiaries
    "linkedin": "Microsoft",
    "linkedin corporation": "Microsoft",
    "github, inc.": "Microsoft",
    "activision blizzard": "Microsoft",
    "zenimax media inc.": "Microsoft",
    "motorola mobile": "Alphabet",
}


def _normalize_company(name: str) -> str:
    """Normalize company name to canonical form."""
    return COMPANY_ALIASES.get(name.lower().strip(), name)


def _build_company_index(facts):
    """Build an index from canonical company name to list of fact indices."""
    idx = defaultdict(list)
    for i, fact in enumerate(facts):
        canonical = _normalize_company(fact.get("company", "Unknown"))
        idx[canonical].append(i)
    return dict(idx)


def load_facts() -> list[dict]:
    """Load all stored financial facts. Cached after first call."""
    global _cached_facts, _company_index
    if _cached_facts is not None:
        return _cached_facts
    if not os.path.exists(MEMORY_PATH):
        return []
    try:
        with open(MEMORY_PATH, "r") as f:
            _cached_facts = json.load(f)
        _company_index = _build_company_index(_cached_facts)
        return _cached_facts
    except json.JSONDecodeError:
        return []


def get_facts_for_companies(company_names: list[str]) -> list[dict]:
    """Return only facts matching the given company names (fast, indexed lookup)."""
    facts = load_facts()
    if _company_index is None:
        return facts

    result_indices = set()
    for name in company_names:
        canonical = _normalize_company(name)
        if canonical in _company_index:
            result_indices.update(_company_index[canonical])
        # Also try the raw name in case it's already canonical
        if name in _company_index:
            result_indices.update(_company_index[name])

    return [facts[i] for i in sorted(result_indices)]


def compact_facts(facts: list[dict]) -> str:
    """Serialize facts in a compact format for LLM prompts.
    Strips evidence/source_file fields and uses no indentation."""
    compact = [
        {"company": f.get("company", ""),
         "year": f.get("year", ""),
         "metric": f.get("metric", ""),
         "value": f.get("value", "")}
        for f in facts
    ]
    return json.dumps(compact)


def save_facts(facts: list[dict]):
    """Save a list of facts to the store. Appends to existing facts."""
    global _cached_facts, _company_index
    existing = load_facts()
    existing.extend(facts)

    os.makedirs(os.path.dirname(MEMORY_PATH), exist_ok=True)
    with open(MEMORY_PATH, "w") as f:
        json.dump(existing, f, indent=2)
    _cached_facts = None
    _company_index = None


def clear_memory():
    """Clear the memory store (useful for testing/re-ingestion)."""
    global _cached_facts, _company_index
    if os.path.exists(MEMORY_PATH):
        os.remove(MEMORY_PATH)
    _cached_facts = None
    _company_index = None
