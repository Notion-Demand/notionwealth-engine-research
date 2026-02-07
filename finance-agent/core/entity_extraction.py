"""Extract company names from user queries using keyword matching."""

# Canonical company names and their query-matching aliases
QUERY_PATTERNS = {
    "Apple": ["apple", "aapl", "iphone", "ipad", "macbook", "ios"],
    "Microsoft": ["microsoft", "msft", "azure", "windows", "xbox", "linkedin", "github", "activision"],
    "Alphabet": ["alphabet", "google", "googl", "youtube", "android", "waymo", "deepmind"],
    "Amazon": ["amazon", "amzn", "aws", "prime video", "alexa"],
    "Meta": ["meta", "facebook", "instagram", "whatsapp", "threads", "oculus"],
    "Tesla": ["tesla", "tsla"],
    "NVIDIA": ["nvidia", "nvda"],
    "Rivian": ["rivian"],
}


def extract_companies(query: str) -> list[str]:
    """
    Extract canonical company names mentioned in a query.
    Returns list of canonical names, e.g. ["Apple", "Microsoft"].
    """
    query_lower = query.lower()
    found = []
    for canonical, aliases in QUERY_PATTERNS.items():
        if any(alias in query_lower for alias in aliases):
            found.append(canonical)
    return found
