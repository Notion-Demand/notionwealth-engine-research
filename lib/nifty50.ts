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
  "Q3_2026",
  "Q2_2026",
  "Q1_2026",
  "Q4_2025",
  "Q3_2025",
  "Q2_2025",
  "Q1_2025",
];

/** The 4 thematic analysis sections — exported for both pipeline and UI */
export const SECTION_NAMES = [
  "Capital & Liquidity",
  "Revenue & Growth",
  "Operational Margin",
  "Macro & Risk",
] as const;

/** Human-readable quarter label: "Q3_2026" → "Q3 FY26" */
export function quarterLabel(q: string): string {
  const m = q.match(/^Q(\d)_(\d{4})$/);
  if (!m) return q;
  return `Q${m[1]} FY${m[2].slice(2)}`;
}
