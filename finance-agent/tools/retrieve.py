from core.vector import search


def search_financials(query: str, k: int = 5):
    """
    Search the finance vector store.
    """
    return search(query, k)
