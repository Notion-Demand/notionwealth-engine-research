"""
Automated Nifty 50 earnings transcript fetcher.
Downloads transcripts from BSE India's public announcements API.
"""
from .transcript_fetcher import fetch_ticker, fetch_all
from .nifty50 import NIFTY50

__all__ = ["fetch_ticker", "fetch_all", "NIFTY50"]
