/** Nifty 50 company registry — mirrors finance-agent/fetcher/nifty50.py */
export interface CompanyInfo {
  bse: number;
  nse: string;
  name: string;
  sector: string;
}

export const NIFTY50: Record<string, CompanyInfo> = {
  RELIANCE: { bse: 500325, nse: "RELIANCE.NS", name: "Reliance Industries", sector: "Conglomerate" },
  TCS: { bse: 532540, nse: "TCS.NS", name: "Tata Consultancy Services", sector: "IT" },
  HDFC: { bse: 500180, nse: "HDFCBANK.NS", name: "HDFC Bank", sector: "Banking" },
  BHARTI: { bse: 532454, nse: "BHARTIARTL.NS", name: "Bharti Airtel", sector: "Telecom" },
  ICICI: { bse: 532174, nse: "ICICIBANK.NS", name: "ICICI Bank", sector: "Banking" },
  INFOSYS: { bse: 500209, nse: "INFY.NS", name: "Infosys", sector: "IT" },
  SBI: { bse: 500112, nse: "SBIN.NS", name: "State Bank of India", sector: "Banking" },
  BAJAJ: { bse: 500034, nse: "BAJFINANCE.NS", name: "Bajaj Finance", sector: "NBFC" },
  LT: { bse: 500510, nse: "LT.NS", name: "Larsen & Toubro", sector: "Infra" },
  HUL: { bse: 500696, nse: "HINDUNILVR.NS", name: "Hindustan Unilever", sector: "FMCG" },
  KOTAKBANK: { bse: 500247, nse: "KOTAKBANK.NS", name: "Kotak Mahindra Bank", sector: "Banking" },
  AXISBANK: { bse: 532215, nse: "AXISBANK.NS", name: "Axis Bank", sector: "Banking" },
  ITC: { bse: 500875, nse: "ITC.NS", name: "ITC", sector: "FMCG" },
  HCLTECH: { bse: 532281, nse: "HCLTECH.NS", name: "HCL Technologies", sector: "IT" },
  WIPRO: { bse: 507685, nse: "WIPRO.NS", name: "Wipro", sector: "IT" },
  ULTRACEMCO: { bse: 532538, nse: "ULTRACEMCO.NS", name: "UltraTech Cement", sector: "Cement" },
  ADANIENT: { bse: 512599, nse: "ADANIENT.NS", name: "Adani Enterprises", sector: "Conglomerate" },
  ADANIPORTS: { bse: 532921, nse: "ADANIPORTS.NS", name: "Adani Ports & SEZ", sector: "Infra" },
  TITAN: { bse: 500114, nse: "TITAN.NS", name: "Titan Company", sector: "Consumer" },
  MARUTI: { bse: 532500, nse: "MARUTI.NS", name: "Maruti Suzuki", sector: "Auto" },
  NTPC: { bse: 532555, nse: "NTPC.NS", name: "NTPC", sector: "Power" },
  POWERGRID: { bse: 532898, nse: "POWERGRID.NS", name: "Power Grid Corporation", sector: "Power" },
  ONGC: { bse: 500312, nse: "ONGC.NS", name: "ONGC", sector: "Oil & Gas" },
  TATAMOTORS: { bse: 500570, nse: "TATAMOTORS.NS", name: "Tata Motors", sector: "Auto" },
  TATASTEEL: { bse: 500470, nse: "TATASTEEL.NS", name: "Tata Steel", sector: "Metals" },
  SBILIFE: { bse: 540719, nse: "SBILIFE.NS", name: "SBI Life Insurance", sector: "Insurance" },
  HDFCLIFE: { bse: 540777, nse: "HDFCLIFE.NS", name: "HDFC Life Insurance", sector: "Insurance" },
  ICICIPRULI: { bse: 540133, nse: "ICICIPRULI.NS", name: "ICICI Prudential Life", sector: "Insurance" },
  SUNPHARMA: { bse: 524715, nse: "SUNPHARMA.NS", name: "Sun Pharmaceutical", sector: "Pharma" },
  DRREDDY: { bse: 500124, nse: "DRREDDY.NS", name: "Dr. Reddy's Laboratories", sector: "Pharma" },
  CIPLA: { bse: 500087, nse: "CIPLA.NS", name: "Cipla", sector: "Pharma" },
  ASIANPAINT: { bse: 500820, nse: "ASIANPAINT.NS", name: "Asian Paints", sector: "Consumer" },
  NESTLEIND: { bse: 500790, nse: "NESTLEIND.NS", name: "Nestle India", sector: "FMCG" },
  BAJAJFINSV: { bse: 532978, nse: "BAJAJFINSV.NS", name: "Bajaj Finserv", sector: "NBFC" },
  JSWSTEEL: { bse: 500228, nse: "JSWSTEEL.NS", name: "JSW Steel", sector: "Metals" },
  COALINDIA: { bse: 533278, nse: "COALINDIA.NS", name: "Coal India", sector: "Mining" },
  INDUSINDBK: { bse: 532187, nse: "INDUSINDBK.NS", name: "IndusInd Bank", sector: "Banking" },
  HINDALCO: { bse: 500440, nse: "HINDALCO.NS", name: "Hindalco Industries", sector: "Metals" },
  GRASIM: { bse: 500300, nse: "GRASIM.NS", name: "Grasim Industries", sector: "Cement" },
  TECHM: { bse: 532755, nse: "TECHM.NS", name: "Tech Mahindra", sector: "IT" },
  EICHERMOT: { bse: 505200, nse: "EICHERMOT.NS", name: "Eicher Motors", sector: "Auto" },
  HEROMOTOCO: { bse: 500182, nse: "HEROMOTOCO.NS", name: "Hero MotoCorp", sector: "Auto" },
  TATACONSUM: { bse: 500800, nse: "TATACONSUM.NS", name: "Tata Consumer Products", sector: "FMCG" },
  BRITANNIA: { bse: 500825, nse: "BRITANNIA.NS", name: "Britannia Industries", sector: "FMCG" },
  APOLLOHOSP: { bse: 508869, nse: "APOLLOHOSP.NS", name: "Apollo Hospitals", sector: "Healthcare" },
  DIVISLAB: { bse: 532488, nse: "DIVISLAB.NS", name: "Divi's Laboratories", sector: "Pharma" },
  LTIM: { bse: 540005, nse: "LTIM.NS", name: "LTIMindtree", sector: "IT" },
  MM: { bse: 500520, nse: "M&M.NS", name: "Mahindra & Mahindra", sector: "Auto" },
  BPCL: { bse: 500547, nse: "BPCL.NS", name: "Bharat Petroleum", sector: "Oil & Gas" },
  BAJAJAUTO: { bse: 532977, nse: "BAJAJ-AUTO.NS", name: "Bajaj Auto", sector: "Auto" },
};

/** Sorted list for dropdown display */
export const NIFTY50_LIST = Object.entries(NIFTY50)
  .map(([ticker, info]) => ({ ticker, ...info }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Available quarters for the picker — add new quarters here as they arrive */
export const QUARTERS = [
  "Q4_2026",
  "Q3_2026",
  "Q2_2026",
  "Q1_2026",
  "Q4_2025",
  "Q3_2025",
  "Q2_2025",
  "Q1_2025",
];

/**
 * 18 sectors — each has ≥5 companies picked from Nifty 200 by market cap.
 * Sectors with fewer Nifty 200 members are kept as-is (e.g. Healthcare).
 * Used for Sector Intelligence seeding.
 */
export const SECTOR_UNIVERSE: Record<string, { tickers: string[]; label: string }> = {
  // ── Core Financials ──────────────────────────────────────────────────────────
  Banking: {
    // Top private + PSU banks by market cap
    tickers: ["HDFC", "ICICI", "SBI", "KOTAKBANK", "AXISBANK", "INDUSINDBK", "PNB", "BANKBARODA"],
    label: "Banking",
  },
  NBFC: {
    // Bajaj Finance, Bajaj Finserv, Muthoot, Chola, Shriram, SBI Card
    tickers: ["BAJAJ", "BAJAJFINSV", "MUTHOOTFIN", "CHOLAFIN", "SHRIRAMFIN", "SBICARD"],
    label: "NBFCs & Consumer Finance",
  },
  Insurance: {
    // LIC (largest by far), SBI Life, HDFC Life, ICICI Pru, ICICI Lombard
    tickers: ["LICI", "SBILIFE", "HDFCLIFE", "ICICIPRULI", "ICICIGI"],
    label: "Insurance",
  },
  // ── Technology ───────────────────────────────────────────────────────────────
  IT: {
    tickers: ["TCS", "INFOSYS", "HCLTECH", "WIPRO", "TECHM", "LTIM", "PERSISTENT", "MPHASIS"],
    label: "IT Services",
  },
  // ── Industrials ─────────────────────────────────────────────────────────────
  Auto: {
    // 4W + 2W + EV + ancillaries
    tickers: ["MARUTI", "TATAMOTORS", "MM", "BAJAJAUTO", "EICHERMOT", "HEROMOTOCO", "TVSMOTOR", "ASHOKLEY"],
    label: "Automobiles",
  },
  CapGoods: {
    // Defense (HAL, BEL), engineering (L&T, Siemens, ABB), electricals (Polycab, Havells)
    tickers: ["LT", "HAL", "BEL", "SIEMENS", "ABB", "POLYCAB", "HAVELLS", "CGPOWER"],
    label: "Capital Goods & Defence",
  },
  Infra: {
    // Ports, railways, airports, logistics
    tickers: ["ADANIPORTS", "RVNL", "CONCOR", "GMRAIRPORT", "INDIGO", "IRB"],
    label: "Infrastructure & Logistics",
  },
  Realty: {
    // Real estate developers — Nifty 200 coverage
    tickers: ["DLF", "GODREJPROP", "LODHA", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD"],
    label: "Real Estate",
  },
  // ── Consumption ──────────────────────────────────────────────────────────────
  FMCG: {
    // Large-cap staples + beverages
    tickers: ["HUL", "ITC", "NESTLEIND", "TATACONSUM", "BRITANNIA", "COLPAL", "DABUR", "MARICO"],
    label: "FMCG",
  },
  Consumer: {
    // Jewellery, paints, electronics, eComm, QSR
    tickers: ["TITAN", "ASIANPAINT", "DMART", "TRENT", "KALYANKJIL", "ETERNAL", "JUBLFOOD"],
    label: "Consumer & Retail",
  },
  // ── Healthcare ───────────────────────────────────────────────────────────────
  Pharma: {
    // Ranked by market cap within Nifty 200
    tickers: ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "TORNTPHARM", "LUPIN", "AUROPHARMA", "MANKIND"],
    label: "Pharmaceuticals",
  },
  Healthcare: {
    // Hospital chains — only 3 in Nifty 200
    tickers: ["APOLLOHOSP", "MAXHEALTH", "FORTIS"],
    label: "Healthcare & Hospitals",
  },
  // ── Energy & Materials ────────────────────────────────────────────────────────
  "Oil & Gas": {
    // Upstream (ONGC, OIL) + downstream (IOC, BPCL, HINDPETRO) + midstream (GAIL)
    tickers: ["RELIANCE", "ONGC", "IOC", "BPCL", "GAIL", "HINDPETRO"],
    label: "Oil & Gas",
  },
  Power: {
    // Thermal (NTPC, Adani Power), transmission (Powergrid), renewables (Adani Green, JSW Energy, Tata Power)
    tickers: ["NTPC", "POWERGRID", "ADANIGREEN", "ADANIPOWER", "TATAPOWER", "JSWENERGY"],
    label: "Power & Utilities",
  },
  Metals: {
    // Steel, aluminium, zinc, copper
    tickers: ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "HINDZINC", "JINDALSTEL", "SAIL"],
    label: "Metals & Mining",
  },
  Cement: {
    // Top 5 cement companies
    tickers: ["ULTRACEMCO", "GRASIM", "AMBUJACEM", "SHREECEM", "ACC"],
    label: "Cement",
  },
  // ── Telecom ──────────────────────────────────────────────────────────────────
  Telecom: {
    // Airtel + subsidiaries + tower + enterprise
    tickers: ["BHARTI", "BHARTIHEXA", "INDUSTOWER", "TATACOMM"],
    label: "Telecom",
  },
};

/** Approximate market caps in ₹ Lakh Cr — used for weighted signal aggregation */
export const MARKET_CAPS: Record<string, number> = {
  // Banking
  HDFC: 13.5, ICICI: 9.5, SBI: 7.5, KOTAKBANK: 4.0, AXISBANK: 3.8, INDUSINDBK: 1.0,
  PNB: 1.0, BANKBARODA: 1.0,
  // NBFCs
  BAJAJ: 5.8, BAJAJFINSV: 2.5, MUTHOOTFIN: 0.8, CHOLAFIN: 1.0, SBICARD: 0.5,
  SHRIRAMFIN: 0.7,
  // Insurance
  LICI: 6.0, SBILIFE: 1.5, HDFCLIFE: 1.4, ICICIPRULI: 0.8, ICICIGI: 0.9,
  // IT
  TCS: 15.0, INFOSYS: 7.5, HCLTECH: 4.5, WIPRO: 2.8, TECHM: 1.5, LTIM: 1.8,
  PERSISTENT: 0.8, MPHASIS: 0.5,
  // Auto
  MARUTI: 4.2, TATAMOTORS: 3.0, MM: 3.8, BAJAJAUTO: 2.5, EICHERMOT: 1.2, HEROMOTOCO: 1.0,
  TVSMOTOR: 1.5, ASHOKLEY: 0.7,
  // Capital Goods
  LT: 5.0, HAL: 3.0, BEL: 1.8, SIEMENS: 1.4, ABB: 0.8, BHEL: 1.2, HAVELLS: 1.2,
  POLYCAB: 0.8, CGPOWER: 0.5,
  // Infra
  ADANIPORTS: 3.2, RVNL: 0.5, CONCOR: 0.6, GMRAIRPORT: 0.9, INDIGO: 0.8, IRB: 0.3,
  // Real Estate
  DLF: 2.0, GODREJPROP: 0.9, LODHA: 1.2, OBEROIRLTY: 0.8, PRESTIGE: 0.5, PHOENIXLTD: 0.7,
  // FMCG
  HUL: 5.8, ITC: 5.5, NESTLEIND: 1.8, TATACONSUM: 1.0, BRITANNIA: 1.2,
  COLPAL: 0.8, DABUR: 0.9, MARICO: 0.6,
  // Consumer & Retail
  TITAN: 3.2, ASIANPAINT: 2.2, DMART: 2.8, TRENT: 1.5,
  KALYANKJIL: 0.5, ETERNAL: 2.5, JUBLFOOD: 0.4,
  // Pharma
  SUNPHARMA: 4.0, DRREDDY: 1.1, CIPLA: 1.2, DIVISLAB: 0.9,
  TORNTPHARM: 0.8, LUPIN: 0.7, AUROPHARMA: 0.5, MANKIND: 0.7,
  // Healthcare
  APOLLOHOSP: 1.0, FORTIS: 0.3, MAXHEALTH: 0.4,
  // Oil & Gas
  RELIANCE: 17.0, ONGC: 3.5, BPCL: 1.5, IOC: 1.5, GAIL: 1.3, HINDPETRO: 0.8,
  // Power
  NTPC: 3.5, POWERGRID: 3.0, TATAPOWER: 1.4, ADANIGREEN: 2.5,
  ADANIPOWER: 1.8, JSWENERGY: 0.8,
  // Metals
  TATASTEEL: 1.8, JSWSTEEL: 2.3, HINDALCO: 1.5,
  VEDL: 1.5, HINDZINC: 1.3, JINDALSTEL: 0.5, SAIL: 0.4,
  // Cement
  ULTRACEMCO: 2.5, GRASIM: 1.8, AMBUJACEM: 1.2, SHREECEM: 0.8, ACC: 0.4,
  // Telecom
  BHARTI: 9.5, BHARTIHEXA: 0.5, INDUSTOWER: 0.9, TATACOMM: 0.3,
  // Sub-sector: PSU Banks (additional)
  CANBK: 0.8, BANKINDIA: 0.6, UNIONBANK: 0.7, INDIANB: 0.5,
  // Sub-sector: Private Banks (additional)
  IDFCFIRSTB: 0.5, FEDERALBNK: 0.4,
  // Sub-sector: Capital Markets
  BSE: 0.6, HDFCAMC: 0.9, MOTILALOFS: 0.5, "360ONE": 0.4, POLICYBZR: 0.5,
  // Sub-sector: IT Mid-caps (additional)
  COFORGE: 0.4, KPITTECH: 0.5,
  // Sub-sector: Renewables (additional)
  NTPCGREEN: 0.6, NHPC: 0.5, TORNTPOWER: 0.4,
};

/**
 * Hardcoded screener.in URL slugs for all Nifty 50 tickers.
 * Bypasses the unreliable search API which mis-resolves several tickers
 * (e.g. "MM" → MMTC, "SBI" → SBI Life, "LT" → LTIMindtree).
 * Non-Nifty50 tickers fall back to the search API.
 */
export const SCREENER_SLUGS: Record<string, string> = {
  // Banking
  HDFC: "/company/HDFCBANK/consolidated/",
  ICICI: "/company/ICICIBANK/consolidated/",
  SBI: "/company/SBIN/consolidated/",
  KOTAKBANK: "/company/KOTAKBANK/consolidated/",
  AXISBANK: "/company/AXISBANK/consolidated/",
  INDUSINDBK: "/company/INDUSINDBK/consolidated/",
  // IT
  TCS: "/company/TCS/consolidated/",
  INFOSYS: "/company/INFY/consolidated/",
  HCLTECH: "/company/HCLTECH/consolidated/",
  WIPRO: "/company/WIPRO/consolidated/",
  TECHM: "/company/TECHM/consolidated/",
  LTIM: "/company/LTM/consolidated/",
  // Auto
  MARUTI: "/company/MARUTI/consolidated/",
  TATAMOTORS: "/company/TMCV/consolidated/",
  MM: "/company/M&M/consolidated/",
  BAJAJAUTO: "/company/BAJAJ-AUTO/consolidated/",
  EICHERMOT: "/company/EICHERMOT/consolidated/",
  HEROMOTOCO: "/company/HEROMOTOCO/consolidated/",
  // FMCG
  HUL: "/company/HINDUNILVR/consolidated/",
  ITC: "/company/ITC/consolidated/",
  NESTLEIND: "/company/NESTLEIND/consolidated/",
  TATACONSUM: "/company/TATACONSUM/consolidated/",
  BRITANNIA: "/company/BRITANNIA/consolidated/",
  // Pharma
  SUNPHARMA: "/company/SUNPHARMA/consolidated/",
  DRREDDY: "/company/DRREDDY/consolidated/",
  CIPLA: "/company/CIPLA/consolidated/",
  DIVISLAB: "/company/DIVISLAB/consolidated/",
  // Oil & Gas
  RELIANCE: "/company/RELIANCE/consolidated/",
  ONGC: "/company/ONGC/consolidated/",
  BPCL: "/company/BPCL/consolidated/",
  // Metals
  TATASTEEL: "/company/TATASTEEL/consolidated/",
  JSWSTEEL: "/company/JSWSTEEL/consolidated/",
  HINDALCO: "/company/HINDALCO/consolidated/",
  // Infra
  LT: "/company/LT/consolidated/",
  ADANIPORTS: "/company/ADANIPORTS/consolidated/",
  // Insurance
  SBILIFE: "/company/SBILIFE/consolidated/",
  HDFCLIFE: "/company/HDFCLIFE/consolidated/",
  ICICIPRULI: "/company/ICICIPRULI/consolidated/",
  // Telecom
  BHARTI: "/company/BHARTIARTL/consolidated/",
  // NBFC
  BAJAJ: "/company/BAJFINANCE/consolidated/",
  BAJAJFINSV: "/company/BAJAJFINSV/consolidated/",
  MUTHOOTFIN: "/company/MUTHOOTFIN/consolidated/",
  CHOLAFIN: "/company/CHOLAFIN/consolidated/",
  SBICARD: "/company/SBICARD/consolidated/",
  // Conglomerate
  ADANIENT: "/company/ADANIENT/consolidated/",
  // Consumer
  TITAN: "/company/TITAN/consolidated/",
  ASIANPAINT: "/company/ASIANPAINT/consolidated/",
  DMART: "/company/DMART/consolidated/",
  TRENT: "/company/TRENT/consolidated/",
  // Capital Goods
  BEL: "/company/BEL/consolidated/",
  SIEMENS: "/company/SIEMENS/consolidated/",
  ABB: "/company/ABB/consolidated/",
  BHEL: "/company/BHEL/standalone/",
  HAVELLS: "/company/HAVELLS/consolidated/",
  // Power
  NTPC: "/company/NTPC/consolidated/",
  POWERGRID: "/company/POWERGRID/consolidated/",
  TATAPOWER: "/company/TATAPOWER/consolidated/",
  ADANIGREEN: "/company/ADANIGREEN/consolidated/",
  // Mining
  COALINDIA: "/company/COALINDIA/consolidated/",
  // Cement
  ULTRACEMCO: "/company/ULTRACEMCO/consolidated/",
  GRASIM: "/company/GRASIM/consolidated/",
  AMBUJACEM: "/company/AMBUJACEM/consolidated/",
  SHREECEM: "/company/SHREECEM/consolidated/",
  // Healthcare
  APOLLOHOSP: "/company/APOLLOHOSP/consolidated/",
  FORTIS: "/company/FORTIS/consolidated/",
  MAXHEALTH: "/company/MAXHEALT/consolidated/",
  // Real Estate
  DLF: "/company/DLF/consolidated/",
  GODREJPROP: "/company/GODREJPROP/standalone/",
  OBEROIRLTY: "/company/OBEROIRLTY/standalone/",
  LODHA: "/company/LODHA/consolidated/",
  PRESTIGE: "/company/PRESTIGE/consolidated/",
  PHOENIXLTD: "/company/PHOENIXLTD/consolidated/",
  // Banking (new)
  PNB: "/company/PNB/consolidated/",
  BANKBARODA: "/company/BANKBARODA/consolidated/",
  // NBFC (new)
  SHRIRAMFIN: "/company/SHRIRAMFIN/consolidated/",
  // Insurance (new)
  LICI: "/company/LICI/consolidated/",
  ICICIGI: "/company/ICICIGI/consolidated/",
  // IT (new)
  PERSISTENT: "/company/PERSISTENT/consolidated/",
  MPHASIS: "/company/MPHASIS/consolidated/",
  // Auto (new)
  TVSMOTOR: "/company/TVSMOTOR/consolidated/",
  ASHOKLEY: "/company/ASHOKLEY/consolidated/",
  // Capital Goods (new)
  HAL: "/company/HAL/consolidated/",
  POLYCAB: "/company/POLYCAB/consolidated/",
  CGPOWER: "/company/CGPOWER/consolidated/",
  // Infra (new)
  RVNL: "/company/RVNL/consolidated/",
  CONCOR: "/company/CONCOR/consolidated/",
  GMRAIRPORT: "/company/GMRAIRPORT/consolidated/",
  INDIGO: "/company/INDIGO/consolidated/",
  IRB: "/company/IRB/consolidated/",
  // FMCG (new)
  COLPAL: "/company/COLPAL/consolidated/",
  DABUR: "/company/DABUR/consolidated/",
  MARICO: "/company/MARICO/consolidated/",
  // Consumer (new)
  KALYANKJIL: "/company/KALYANKJIL/consolidated/",
  ETERNAL: "/company/ETERNAL/consolidated/",
  JUBLFOOD: "/company/JUBLFOOD/consolidated/",
  // Pharma (new)
  TORNTPHARM: "/company/TORNTPHARM/consolidated/",
  LUPIN: "/company/LUPIN/consolidated/",
  AUROPHARMA: "/company/AUROPHARMA/consolidated/",
  MANKIND: "/company/MANKIND/consolidated/",
  // Oil & Gas (new)
  IOC: "/company/IOC/consolidated/",
  GAIL: "/company/GAIL/consolidated/",
  HINDPETRO: "/company/HINDPETRO/consolidated/",
  // Power (new)
  ADANIPOWER: "/company/ADANIPOWER/consolidated/",
  JSWENERGY: "/company/JSWENERGY/consolidated/",
  // Metals (new)
  VEDL: "/company/VEDL/consolidated/",
  HINDZINC: "/company/HINDZINC/standalone/",
  JINDALSTEL: "/company/JINDALSTEL/consolidated/",
  SAIL: "/company/SAIL/consolidated/",
  // Cement (new)
  ACC: "/company/ACC/consolidated/",
  // Telecom (new)
  BHARTIHEXA: "/company/BHARTIHEXA/consolidated/",
  INDUSTOWER: "/company/INDUSTOWER/consolidated/",
  TATACOMM: "/company/TATACOMM/consolidated/",
};

/** The 5 thematic analysis sections — exported for both pipeline and UI */
export const SECTION_NAMES = [
  "Revenue & Growth",
  "Margins & Profitability",
  "Cost Structure",
  "CapEx & Balance Sheet",
  "Macro & Risk",
] as const;

/** Human-readable quarter label: "Q3_2026" → "Q3 FY26" */
export function quarterLabel(q: string): string {
  const m = q.match(/^Q(\d)_(\d{4})$/);
  if (!m) return q;
  return `Q${m[1]} FY${m[2].slice(2)}`;
}
