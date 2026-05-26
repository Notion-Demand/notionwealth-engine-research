"""
Shared analysis runner used by both Slack and email integrations.
Wraps the multi-agent pipeline with caching and ticker resolution.
"""
import asyncio
import json
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# Disk cache directory (same cache as the Streamlit UI)
_CACHE_DIR = Path(__file__).parent.parent / "cache"


def _cache_path(q_prev: str, q_curr: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = f"{Path(q_prev).stem}__{Path(q_curr).stem}"
    return _CACHE_DIR / f"{key}.json"


def _load_cache(q_prev: str, q_curr: str) -> dict | None:
    p = _cache_path(q_prev, q_curr)
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return None


def _save_cache(q_prev: str, q_curr: str, payload: dict) -> None:
    with open(_cache_path(q_prev, q_curr), "w") as f:
        json.dump(payload, f)


async def run_analysis(query: str, force_refresh: bool = False) -> dict:
    """
    End-to-end analysis runner:
    1. Extract ticker from natural-language query
    2. Discover two consecutive quarter PDFs
    3. Return cached payload if available; otherwise run the pipeline

    Returns the DashboardPayload as a dict.
    Raises ValueError / FileNotFoundError with a human-readable message on failure.
    """
    # Lazy imports so this module can be imported without heavy deps available
    from multiagent_analysis.parser import extract_ticker_from_query, discover_pdfs
    from multiagent_analysis.pipeline import run_pipeline

    ticker = extract_ticker_from_query(query)
    if not ticker:
        from multiagent_analysis.parser import list_available_companies
        available = list_available_companies()
        raise ValueError(
            f"Could not identify a company from: '{query}'. "
            f"Available: {', '.join(available) or 'none loaded yet'}"
        )

    q_prev_path, q_curr_path = discover_pdfs(ticker)
    logger.info(f"Discovered PDFs: {Path(q_prev_path).name} → {Path(q_curr_path).name}")

    if not force_refresh:
        cached = _load_cache(q_prev_path, q_curr_path)
        if cached:
            logger.info("Returning cached payload")
            return cached

    logger.info(f"Running multi-agent pipeline for {ticker}…")
    payload = await run_pipeline(q_prev_path, q_curr_path)
    _save_cache(q_prev_path, q_curr_path, payload)
    return payload


def run_analysis_sync(query: str, force_refresh: bool = False) -> dict:
    """Synchronous wrapper — safe to call from a worker thread."""
    return asyncio.run(run_analysis(query, force_refresh))
