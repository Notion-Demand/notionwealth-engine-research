"""
Nifty 50 company registry — single source of truth.

Key naming rules:
  - Ticker keys are alpha-only to satisfy filename regex ^([A-Za-z]+)_Q(\\d)_(\\d{4})\\.pdf$
  - MM (not M&M), BAJAJAUTO (not BAJAJ-AUTO)
  - Existing keys preserved verbatim: BHARTI, SBI, HDFC, BAJAJ, ICICI,
    INFOSYS, LT, HUL, TCS, RELIANCE

BSE scrip codes marked ⚠ should be verified against bseindia.com:
  SBILIFE, HDFCLIFE, ICICIPRULI, LTIM
"""

# Maps internal ticker → {bse: int, nse: str, name: str}
NIFTY50: dict[str, dict] = {
    # ── Existing tickers (keys preserved for backward-compat with existing PDFs) ──
    "RELIANCE":   {"bse": 500325, "nse": "RELIANCE.NS",   "name": "Reliance Industries"},
    "TCS":        {"bse": 532540, "nse": "TCS.NS",         "name": "Tata Consultancy Services"},
    "HDFC":       {"bse": 500180, "nse": "HDFCBANK.NS",    "name": "HDFC Bank"},
    "BHARTI":     {"bse": 532454, "nse": "BHARTIARTL.NS",  "name": "Bharti Airtel"},
    "ICICI":      {"bse": 532174, "nse": "ICICIBANK.NS",   "name": "ICICI Bank"},
    "INFOSYS":    {"bse": 500209, "nse": "INFY.NS",        "name": "Infosys"},
    "SBI":        {"bse": 500112, "nse": "SBIN.NS",        "name": "State Bank of India"},
    "BAJAJ":      {"bse": 500034, "nse": "BAJFINANCE.NS",  "name": "Bajaj Finance"},
    "LT":         {"bse": 500510, "nse": "LT.NS",          "name": "Larsen & Toubro"},
    "HUL":        {"bse": 500696, "nse": "HINDUNILVR.NS",  "name": "Hindustan Unilever"},

    # ── Remaining Nifty 50 ──
    "KOTAKBANK":  {"bse": 500247, "nse": "KOTAKBANK.NS",   "name": "Kotak Mahindra Bank"},
    "AXISBANK":   {"bse": 532215, "nse": "AXISBANK.NS",    "name": "Axis Bank"},
    "ITC":        {"bse": 500875, "nse": "ITC.NS",         "name": "ITC"},
    "HCLTECH":    {"bse": 532281, "nse": "HCLTECH.NS",     "name": "HCL Technologies"},
    "WIPRO":      {"bse": 507685, "nse": "WIPRO.NS",       "name": "Wipro"},
    "ULTRACEMCO": {"bse": 532538, "nse": "ULTRACEMCO.NS",  "name": "UltraTech Cement"},
    "ADANIENT":   {"bse": 512599, "nse": "ADANIENT.NS",    "name": "Adani Enterprises"},
    "ADANIPORTS": {"bse": 532921, "nse": "ADANIPORTS.NS",  "name": "Adani Ports & SEZ"},
    "TITAN":      {"bse": 500114, "nse": "TITAN.NS",       "name": "Titan Company"},
    "MARUTI":     {"bse": 532500, "nse": "MARUTI.NS",      "name": "Maruti Suzuki"},
    "NTPC":       {"bse": 532555, "nse": "NTPC.NS",        "name": "NTPC"},
    "POWERGRID":  {"bse": 532898, "nse": "POWERGRID.NS",   "name": "Power Grid Corporation"},
    "ONGC":       {"bse": 500312, "nse": "ONGC.NS",        "name": "Oil & Natural Gas Corporation"},
    "TATAMOTORS": {"bse": 500570, "nse": "TATAMOTORS.NS",  "name": "Tata Motors"},
    "TATASTEEL":  {"bse": 500470, "nse": "TATASTEEL.NS",   "name": "Tata Steel"},
    "SBILIFE":    {"bse": 540719, "nse": "SBILIFE.NS",     "name": "SBI Life Insurance"},      # ⚠ verify
    "HDFCLIFE":   {"bse": 540777, "nse": "HDFCLIFE.NS",    "name": "HDFC Life Insurance"},     # ⚠ verify
    "ICICIPRULI": {"bse": 540133, "nse": "ICICIPRULI.NS",  "name": "ICICI Prudential Life"},   # ⚠ verify
    "SUNPHARMA":  {"bse": 524715, "nse": "SUNPHARMA.NS",   "name": "Sun Pharmaceutical"},
    "DRREDDY":    {"bse": 500124, "nse": "DRREDDY.NS",     "name": "Dr. Reddy's Laboratories"},
    "CIPLA":      {"bse": 500087, "nse": "CIPLA.NS",       "name": "Cipla"},
    "ASIANPAINT": {"bse": 500820, "nse": "ASIANPAINT.NS",  "name": "Asian Paints"},
    "NESTLEIND":  {"bse": 500790, "nse": "NESTLEIND.NS",   "name": "Nestle India"},
    "BAJAJFINSV": {"bse": 532978, "nse": "BAJAJFINSV.NS",  "name": "Bajaj Finserv"},
    "JSWSTEEL":   {"bse": 500228, "nse": "JSWSTEEL.NS",    "name": "JSW Steel"},
    "COALINDIA":  {"bse": 533278, "nse": "COALINDIA.NS",   "name": "Coal India"},
    "INDUSINDBK": {"bse": 532187, "nse": "INDUSINDBK.NS",  "name": "IndusInd Bank"},
    "HINDALCO":   {"bse": 500440, "nse": "HINDALCO.NS",    "name": "Hindalco Industries"},
    "GRASIM":     {"bse": 500300, "nse": "GRASIM.NS",      "name": "Grasim Industries"},
    "TECHM":      {"bse": 532755, "nse": "TECHM.NS",       "name": "Tech Mahindra"},
    "EICHERMOT":  {"bse": 505200, "nse": "EICHERMOT.NS",   "name": "Eicher Motors"},
    "HEROMOTOCO": {"bse": 500182, "nse": "HEROMOTOCO.NS",  "name": "Hero MotoCorp"},
    "TATACONSUM": {"bse": 500800, "nse": "TATACONSUM.NS",  "name": "Tata Consumer Products"},
    "BRITANNIA":  {"bse": 500825, "nse": "BRITANNIA.NS",   "name": "Britannia Industries"},
    "APOLLOHOSP": {"bse": 508869, "nse": "APOLLOHOSP.NS",  "name": "Apollo Hospitals"},
    "DIVISLAB":   {"bse": 532488, "nse": "DIVISLAB.NS",    "name": "Divi's Laboratories"},
    "LTIM":       {"bse": 540005, "nse": "LTIM.NS",        "name": "LTIMindtree"},               # ⚠ verify
    "MM":         {"bse": 500520, "nse": "M&M.NS",         "name": "Mahindra & Mahindra"},       # key=MM (not M&M)
    "BPCL":       {"bse": 500547, "nse": "BPCL.NS",        "name": "Bharat Petroleum"},
    "BAJAJAUTO":  {"bse": 532977, "nse": "BAJAJ-AUTO.NS",  "name": "Bajaj Auto"},                # key=BAJAJAUTO (not BAJAJ-AUTO)
}
