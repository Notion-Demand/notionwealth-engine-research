"""
PDF parser for extracting raw transcript text from earnings call PDFs.
Designed for maximum simplicity — no chunking needed with Gemini's large context window.
"""
import os
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from difflib import SequenceMatcher

import pdfplumber

logger = logging.getLogger(__name__)

# Default data directory (relative to finance-agent/)
DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "all-pdfs")

# Mapping: our PDF ticker → yfinance NSE symbol (for stock price data)
NSE_TICKERS = {
    # ── Original 10 (keys preserved verbatim) ──
    "BHARTI":     "BHARTIARTL.NS",
    "SBI":        "SBIN.NS",
    "HDFC":       "HDFCBANK.NS",
    "BAJAJ":      "BAJFINANCE.NS",
    "RELIANCE":   "RELIANCE.NS",
    "TCS":        "TCS.NS",
    "INFOSYS":    "INFY.NS",
    "ICICI":      "ICICIBANK.NS",
    "LT":         "LT.NS",
    "HUL":        "HINDUNILVR.NS",
    # ── Remaining Nifty 50 ──
    "KOTAKBANK":  "KOTAKBANK.NS",
    "AXISBANK":   "AXISBANK.NS",
    "ITC":        "ITC.NS",
    "HCLTECH":    "HCLTECH.NS",
    "WIPRO":      "WIPRO.NS",
    "ULTRACEMCO": "ULTRACEMCO.NS",
    "ADANIENT":   "ADANIENT.NS",
    "ADANIPORTS": "ADANIPORTS.NS",
    "TITAN":      "TITAN.NS",
    "MARUTI":     "MARUTI.NS",
    "NTPC":       "NTPC.NS",
    "POWERGRID":  "POWERGRID.NS",
    "ONGC":       "ONGC.NS",
    "TATAMOTORS": "TATAMOTORS.NS",
    "TATASTEEL":  "TATASTEEL.NS",
    "SBILIFE":    "SBILIFE.NS",
    "HDFCLIFE":   "HDFCLIFE.NS",
    "ICICIPRULI": "ICICIPRULI.NS",
    "SUNPHARMA":  "SUNPHARMA.NS",
    "DRREDDY":    "DRREDDY.NS",
    "CIPLA":      "CIPLA.NS",
    "ASIANPAINT": "ASIANPAINT.NS",
    "NESTLEIND":  "NESTLEIND.NS",
    "BAJAJFINSV": "BAJAJFINSV.NS",
    "JSWSTEEL":   "JSWSTEEL.NS",
    "COALINDIA":  "COALINDIA.NS",
    "INDUSINDBK": "INDUSINDBK.NS",
    "HINDALCO":   "HINDALCO.NS",
    "GRASIM":     "GRASIM.NS",
    "TECHM":      "TECHM.NS",
    "EICHERMOT":  "EICHERMOT.NS",
    "HEROMOTOCO": "HEROMOTOCO.NS",
    "TATACONSUM": "TATACONSUM.NS",
    "BRITANNIA":  "BRITANNIA.NS",
    "APOLLOHOSP": "APOLLOHOSP.NS",
    "DIVISLAB":   "DIVISLAB.NS",
    "LTIM":       "LTIM.NS",
    "MM":         "M&M.NS",
    "BPCL":       "BPCL.NS",
    "BAJAJAUTO":  "BAJAJ-AUTO.NS",
}

# Comprehensive alias dictionary — maps every known name/abbreviation to the PDF ticker
# Format: "alias (lowercase)" → "TICKER (as it appears in filenames)"
TICKER_ALIASES: dict = {
    # ── Original 10 ──────────────────────────────────────────────────────────

    # Reliance Industries
    "reliance": "RELIANCE",
    "reliance industries": "RELIANCE",
    "ril": "RELIANCE",
    "jio": "RELIANCE",

    # Tata Consultancy Services
    "tcs": "TCS",
    "tata consultancy": "TCS",
    "tata consultancy services": "TCS",

    # HDFC Bank
    "hdfc": "HDFC",
    "hdfc bank": "HDFC",
    "housing development finance": "HDFC",

    # Bharti Airtel
    "bharti": "BHARTI",
    "airtel": "BHARTI",
    "bharti airtel": "BHARTI",

    # Infosys
    "infosys": "INFOSYS",
    "infy": "INFOSYS",

    # ICICI Bank
    "icici": "ICICI",
    "icici bank": "ICICI",

    # State Bank of India
    "sbi": "SBI",
    "state bank": "SBI",
    "state bank of india": "SBI",
    "state bank india": "SBI",

    # Larsen & Toubro
    "l&t": "LT",
    "lt": "LT",
    "larsen": "LT",
    "larsen and toubro": "LT",
    "larsen & toubro": "LT",
    "larsen toubro": "LT",

    # Bajaj Finance
    "bajaj": "BAJAJ",
    "bajaj finance": "BAJAJ",
    "bajfinance": "BAJAJ",

    # Hindustan Unilever
    "hul": "HUL",
    "hindustan unilever": "HUL",
    "unilever india": "HUL",
    "hindustan lever": "HUL",

    # ── New Nifty 50 additions ────────────────────────────────────────────────

    # Kotak Mahindra Bank
    "kotak": "KOTAKBANK",
    "kotak bank": "KOTAKBANK",
    "kotak mahindra": "KOTAKBANK",
    "kotak mahindra bank": "KOTAKBANK",
    "kotakbank": "KOTAKBANK",

    # Axis Bank
    "axis": "AXISBANK",
    "axis bank": "AXISBANK",
    "axisbank": "AXISBANK",

    # ITC
    "itc": "ITC",
    "itc limited": "ITC",
    "indian tobacco": "ITC",

    # HCL Technologies
    "hcl": "HCLTECH",
    "hcltech": "HCLTECH",
    "hcl tech": "HCLTECH",
    "hcl technologies": "HCLTECH",

    # Wipro
    "wipro": "WIPRO",

    # UltraTech Cement
    "ultratech": "ULTRACEMCO",
    "ultratech cement": "ULTRACEMCO",
    "ultracemco": "ULTRACEMCO",

    # Adani Enterprises
    "adani": "ADANIENT",
    "adani enterprises": "ADANIENT",
    "adanient": "ADANIENT",

    # Adani Ports
    "adani ports": "ADANIPORTS",
    "adaniports": "ADANIPORTS",
    "adani ports sez": "ADANIPORTS",

    # Titan Company
    "titan": "TITAN",
    "titan company": "TITAN",

    # Maruti Suzuki
    "maruti": "MARUTI",
    "maruti suzuki": "MARUTI",
    "suzuki": "MARUTI",

    # NTPC
    "ntpc": "NTPC",
    "national thermal power": "NTPC",

    # Power Grid Corporation
    "powergrid": "POWERGRID",
    "power grid": "POWERGRID",
    "power grid corporation": "POWERGRID",

    # ONGC
    "ongc": "ONGC",
    "oil and natural gas": "ONGC",
    "oil natural gas corporation": "ONGC",

    # Tata Motors
    "tata motors": "TATAMOTORS",
    "tatamotors": "TATAMOTORS",
    "jaguar land rover": "TATAMOTORS",
    "jlr": "TATAMOTORS",

    # Tata Steel
    "tata steel": "TATASTEEL",
    "tatasteel": "TATASTEEL",

    # SBI Life Insurance
    "sbi life": "SBILIFE",
    "sbilife": "SBILIFE",
    "sbi life insurance": "SBILIFE",

    # HDFC Life Insurance
    "hdfc life": "HDFCLIFE",
    "hdfclife": "HDFCLIFE",
    "hdfc life insurance": "HDFCLIFE",

    # ICICI Prudential Life
    "icici pru": "ICICIPRULI",
    "icici prudential": "ICICIPRULI",
    "icicipruli": "ICICIPRULI",
    "icici prudential life": "ICICIPRULI",

    # Sun Pharmaceutical
    "sun pharma": "SUNPHARMA",
    "sunpharma": "SUNPHARMA",
    "sun pharmaceutical": "SUNPHARMA",

    # Dr. Reddy's Laboratories
    "dr reddy": "DRREDDY",
    "drreddy": "DRREDDY",
    "dr reddys": "DRREDDY",
    "dr reddy's": "DRREDDY",
    "dr. reddy": "DRREDDY",

    # Cipla
    "cipla": "CIPLA",

    # Asian Paints
    "asian paints": "ASIANPAINT",
    "asianpaint": "ASIANPAINT",

    # Nestle India
    "nestle": "NESTLEIND",
    "nestleind": "NESTLEIND",
    "nestle india": "NESTLEIND",

    # Bajaj Finserv
    "bajaj finserv": "BAJAJFINSV",
    "bajajfinsv": "BAJAJFINSV",

    # JSW Steel
    "jsw steel": "JSWSTEEL",
    "jswsteel": "JSWSTEEL",
    "jsw": "JSWSTEEL",

    # Coal India
    "coal india": "COALINDIA",
    "coalindia": "COALINDIA",

    # IndusInd Bank
    "indusind": "INDUSINDBK",
    "indusindbk": "INDUSINDBK",
    "indusind bank": "INDUSINDBK",

    # Hindalco Industries
    "hindalco": "HINDALCO",
    "hindalco industries": "HINDALCO",

    # Grasim Industries
    "grasim": "GRASIM",
    "grasim industries": "GRASIM",

    # Tech Mahindra
    "tech mahindra": "TECHM",
    "techm": "TECHM",
    "tech m": "TECHM",

    # Eicher Motors / Royal Enfield
    "eicher": "EICHERMOT",
    "eichermot": "EICHERMOT",
    "eicher motors": "EICHERMOT",
    "royal enfield": "EICHERMOT",

    # Hero MotoCorp
    "hero": "HEROMOTOCO",
    "heromotoco": "HEROMOTOCO",
    "hero motocorp": "HEROMOTOCO",
    "hero honda": "HEROMOTOCO",

    # Tata Consumer Products
    "tata consumer": "TATACONSUM",
    "tataconsum": "TATACONSUM",
    "tata consumer products": "TATACONSUM",
    "tata global": "TATACONSUM",

    # Britannia Industries
    "britannia": "BRITANNIA",
    "britannia industries": "BRITANNIA",

    # Apollo Hospitals
    "apollo": "APOLLOHOSP",
    "apollohosp": "APOLLOHOSP",
    "apollo hospitals": "APOLLOHOSP",

    # Divi's Laboratories
    "divis": "DIVISLAB",
    "divislab": "DIVISLAB",
    "divi's": "DIVISLAB",
    "divis lab": "DIVISLAB",
    "divis laboratories": "DIVISLAB",

    # LTIMindtree
    "ltim": "LTIM",
    "ltimindtree": "LTIM",
    "lti mindtree": "LTIM",
    "mindtree": "LTIM",

    # Mahindra & Mahindra
    "mahindra": "MM",
    "m&m": "MM",
    "mahindra mahindra": "MM",
    "mahindra and mahindra": "MM",

    # Bharat Petroleum
    "bpcl": "BPCL",
    "bharat petroleum": "BPCL",

    # Bajaj Auto
    "bajaj auto": "BAJAJAUTO",
    "bajajauto": "BAJAJAUTO",
}


def extract_ticker_from_query(query: str, data_dir: str = None) -> Optional[str]:
    """
    Extract company ticker from a natural language query using alias dictionary.
    Falls back to fuzzy match against available PDF tickers if not in dictionary.

    e.g. "Analyze State Bank of India" → "SBI"
         "HDFC Bank disclosure changes" → "HDFC"
    """
    query_lower = query.lower().strip()

    # Step 1: Dictionary lookup — try longest aliases first (multi-word before single)
    for alias in sorted(TICKER_ALIASES.keys(), key=len, reverse=True):
        if alias in query_lower:
            ticker = TICKER_ALIASES[alias]
            logger.info(f"Dict match: '{alias}' → {ticker}")
            return ticker

    # Step 2: Fallback — fuzzy match against whatever tickers exist in the PDF directory
    available = list_available_companies(data_dir)
    if not available:
        logger.warning("No companies found in data directory")
        return None

    stopwords = {"analyze", "analyse", "for", "latest", "disclosure", "changes",
                 "the", "of", "in", "and", "show", "me", "get", "run", "check",
                 "quarterly", "quarter", "report", "earning", "earnings", "call"}
    words = [w for w in query_lower.split() if w not in stopwords and len(w) > 1]

    best_match, best_score = None, 0.0
    for company in available:
        for word in words:
            score = SequenceMatcher(None, word, company.lower()).ratio()
            if score > best_score:
                best_score, best_match = score, company

    if best_match and best_score >= 0.5:
        logger.info(f"Fuzzy fallback: '{best_match}' (score={best_score:.2f})")
        return best_match

    logger.warning(f"No match found for query: '{query}'. Available: {available}")
    return None


def list_available_companies(data_dir: str = None) -> List[str]:
    """List all unique company tickers found in the data directory."""
    data_dir = data_dir or DEFAULT_DATA_DIR
    if not os.path.exists(data_dir):
        return []

    companies = set()
    for f in os.listdir(data_dir):
        if f.endswith(".pdf"):
            info = parse_filename(f)
            if info:
                companies.add(info["company"])
    return sorted(companies)


def discover_pdfs(company: str, data_dir: str = None) -> Tuple[str, str]:
    """
    Find the two most recent consecutive quarter PDFs for a company.

    Returns:
        (q_prev_path, q_curr_path) — paths to the two PDFs
    
    Raises:
        ValueError if fewer than 2 matching PDFs found
    """
    data_dir = data_dir or DEFAULT_DATA_DIR
    if not os.path.exists(data_dir):
        raise FileNotFoundError(f"Data directory not found: {data_dir}")

    # Find all PDFs for this company
    matches = []
    for f in os.listdir(data_dir):
        if f.endswith(".pdf"):
            info = parse_filename(f)
            if info and info["company"] == company.upper():
                # Parse quarter for sorting: Q3_2026 → (2026, 3)
                q_match = re.match(r"Q(\d)_(\d{4})", info["quarter"])
                if q_match:
                    year = int(q_match.group(2))
                    q_num = int(q_match.group(1))
                    sort_key = year * 10 + q_num
                    matches.append((sort_key, info["quarter"], os.path.join(data_dir, f)))

    if len(matches) < 2:
        available = list_available_companies(data_dir)
        raise ValueError(
            f"Need at least 2 PDFs for {company.upper()}, found {len(matches)}. "
            f"Available companies: {', '.join(available)}"
        )

    # Sort by quarter (ascending) and pick last two
    matches.sort(key=lambda x: x[0])
    q_prev = matches[-2]
    q_curr = matches[-1]

    logger.info(f"Discovered PDFs for {company.upper()}: {q_prev[1]} → {q_curr[1]}")
    return q_prev[2], q_curr[2]


def extract_text(pdf_path: str) -> str:
    """Extract full text from a PDF file."""
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    pages = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages.append(text)

    full_text = "\n\n".join(pages)
    logger.info(f"Extracted {len(pages)} pages ({len(full_text)} chars) from {path.name}")
    return full_text


def parse_filename(filename: str) -> Optional[Dict[str, str]]:
    """
    Parse filename to extract company ticker and quarter.
    Supports: CompanyTicker_Q#_Year.pdf (e.g., Bharti_Q3_2026.pdf)
    """
    pattern = r"^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$"
    match = re.match(pattern, filename)
    if match:
        return {
            "company": match.group(1).upper(),
            "quarter": f"Q{match.group(2)}_{match.group(3)}"
        }
    logger.warning(f"Filename {filename} doesn't match expected format")
    return None


def load_transcript_pair(q_prev_path: str, q_curr_path: str) -> Dict:
    """
    Load and parse a pair of quarterly transcripts.
    
    Returns:
        {
            "company": "BHARTI",
            "q_prev": {"quarter": "Q3_2026", "text": "..."},
            "q_curr": {"quarter": "Q4_2026", "text": "..."}
        }
    """
    prev_info = parse_filename(Path(q_prev_path).name)
    curr_info = parse_filename(Path(q_curr_path).name)

    if not prev_info or not curr_info:
        raise ValueError("PDF filenames must match format: CompanyTicker_Q#_Year.pdf")

    if prev_info["company"] != curr_info["company"]:
        raise ValueError(f"Company mismatch: {prev_info['company']} vs {curr_info['company']}")

    text_prev = extract_text(q_prev_path)
    text_curr = extract_text(q_curr_path)

    return {
        "company": curr_info["company"],
        "q_prev": {"quarter": prev_info["quarter"], "text": text_prev},
        "q_curr": {"quarter": curr_info["quarter"], "text": text_curr},
    }
