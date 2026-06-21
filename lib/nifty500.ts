/**
 * Nifty 500 universe for the Videos tab.
 * Combines NIFTY50 + NIFTY200 + additional Midcap/Smallcap companies.
 * Category: "Nifty 50" | "Nifty Next 50" | "Midcap 150" | "Smallcap 250"
 */
import { NIFTY50 } from "./nifty50";
import { NIFTY200 } from "./nifty200";

export interface N500Entry {
    ticker: string;
    name: string;
    sector: string;
    category: "Nifty 50" | "Nifty Next 50" | "Midcap 150" | "Smallcap 250";
}

const NIFTY50_TICKERS = new Set(Object.keys(NIFTY50));

// Additional Nifty 500 companies not in Nifty 200 (Midcap 150 + Smallcap 250 subset)
const EXTENDED_COMPANIES: Omit<N500Entry, "category">[] = [
    // Midcap 150
    { ticker: "AAVAS", name: "Aavas Financiers", sector: "Financial Services" },
    { ticker: "AFFLE", name: "Affle India", sector: "IT" },
    { ticker: "ALKYLAMINE", name: "Alkyl Amines Chemicals", sector: "Chemicals" },
    { ticker: "ALOKINDS", name: "Alok Industries", sector: "Consumer" },
    { ticker: "AMARAJABAT", name: "Amara Raja Energy", sector: "Auto" },
    { ticker: "ANGELONE", name: "Angel One", sector: "Financial Services" },
    { ticker: "APLAPOLLO", name: "APL Apollo Tubes", sector: "Metals" },
    { ticker: "ATUL", name: "Atul Ltd", sector: "Chemicals" },
    { ticker: "BASF", name: "BASF India", sector: "Chemicals" },
    { ticker: "BAYERCROP", name: "Bayer CropScience", sector: "Chemicals" },
    { ticker: "BDL", name: "Bharat Dynamics", sector: "Capital Goods" },
    { ticker: "BECTORFOOD", name: "Mrs Bectors Food", sector: "FMCG" },
    { ticker: "BIKAJI", name: "Bikaji Foods", sector: "FMCG" },
    { ticker: "BLUESTARLT", name: "Blue Star", sector: "Consumer" },
    { ticker: "BRIGADE", name: "Brigade Enterprises", sector: "Realty" },
    { ticker: "BSOFT", name: "Birlasoft", sector: "IT" },
    { ticker: "CAMPUS", name: "Campus Activewear", sector: "Consumer" },
    { ticker: "CARBORUNIV", name: "Carborundum Universal", sector: "Capital Goods" },
    { ticker: "CASTROLIND", name: "Castrol India", sector: "Oil & Gas" },
    { ticker: "CDSL", name: "Central Depository Services", sector: "Financial Services" },
    { ticker: "CENTURYPLY", name: "Century Plyboards", sector: "Consumer" },
    { ticker: "CERA", name: "Cera Sanitaryware", sector: "Consumer" },
    { ticker: "CHAMBLFERT", name: "Chambal Fertilisers", sector: "Chemicals" },
    { ticker: "CLEAN", name: "Clean Science & Technology", sector: "Chemicals" },
    { ticker: "CRAFTSMAN", name: "Craftsman Automation", sector: "Auto" },
    { ticker: "CROMPTON", name: "Crompton Greaves Consumer", sector: "Consumer" },
    { ticker: "CYIENT", name: "Cyient", sector: "IT" },
    { ticker: "DATAPATTNS", name: "Data Patterns", sector: "Capital Goods" },
    { ticker: "DEEPAKFERT", name: "Deepak Fertilisers", sector: "Chemicals" },
    { ticker: "DEVYANI", name: "Devyani International", sector: "Consumer" },
    { ticker: "ELGIEQUIP", name: "Elgi Equipments", sector: "Capital Goods" },
    { ticker: "EMAMILTD", name: "Emami", sector: "FMCG" },
    { ticker: "ENDURANCE", name: "Endurance Technologies", sector: "Auto" },
    { ticker: "EQUITASBNK", name: "Equitas Small Finance Bank", sector: "Banking" },
    { ticker: "ERIS", name: "Eris Lifesciences", sector: "Pharma" },
    { ticker: "FINEORG", name: "Fine Organic Industries", sector: "Chemicals" },
    { ticker: "FIVESTAR", name: "Five-Star Business Finance", sector: "Financial Services" },
    { ticker: "FLUOROCHEM", name: "Gujarat Fluorochemicals", sector: "Chemicals" },
    { ticker: "GLAND", name: "Gland Pharma", sector: "Pharma" },
    { ticker: "GLAXO", name: "GlaxoSmithKline Pharma", sector: "Pharma" },
    { ticker: "GNFC", name: "Gujarat Narmada Valley Fertilizers", sector: "Chemicals" },
    { ticker: "GRINDWELL", name: "Grindwell Norton", sector: "Capital Goods" },
    { ticker: "GSPL", name: "Gujarat State Petronet", sector: "Oil & Gas" },
    { ticker: "HAPPSTMNDS", name: "Happiest Minds Technologies", sector: "IT" },
    { ticker: "HBLPOWER", name: "HBL Power Systems", sector: "Capital Goods" },
    { ticker: "HONASA", name: "Honasa Consumer (Mamaearth)", sector: "FMCG" },
    { ticker: "HUDCO", name: "Housing & Urban Development Corp", sector: "Financial Services" },
    { ticker: "IBREALEST", name: "Indiabulls Real Estate", sector: "Realty" },
    { ticker: "IDEAFORGE", name: "ideaForge Technology", sector: "Capital Goods" },
    { ticker: "IIFL", name: "IIFL Finance", sector: "Financial Services" },
    { ticker: "INDIGOPNTS", name: "Indigo Paints", sector: "Consumer" },
    { ticker: "INTELLECT", name: "Intellect Design Arena", sector: "IT" },
    { ticker: "IRFC", name: "Indian Railway Finance Corp", sector: "Financial Services" },
    { ticker: "JKCEMENT", name: "JK Cement", sector: "Cement" },
    { ticker: "JSWINFRA", name: "JSW Infrastructure", sector: "Infra" },
    { ticker: "JTEKTINDIA", name: "JTEKT India", sector: "Auto" },
    { ticker: "JUBLINGREA", name: "Jubilant Ingrevia", sector: "Chemicals" },
    { ticker: "JUSTDIAL", name: "Just Dial", sector: "IT" },
    { ticker: "KALYANKJIL", name: "Kalyan Jewellers", sector: "Consumer" },
    { ticker: "KAYNES", name: "Kaynes Technology", sector: "Capital Goods" },
    { ticker: "KEC", name: "KEC International", sector: "Capital Goods" },
    { ticker: "KFINTECH", name: "KFin Technologies", sector: "Financial Services" },
    { ticker: "KIMS", name: "Krishna Institute of Medical Sciences", sector: "Healthcare" },
    { ticker: "LATENTVIEW", name: "Latent View Analytics", sector: "IT" },
    { ticker: "LAXMIMACH", name: "Lakshmi Machine Works", sector: "Capital Goods" },
    { ticker: "MAPMYINDIA", name: "C.E. Info Systems (MapMyIndia)", sector: "IT" },
    { ticker: "MASTEK", name: "Mastek", sector: "IT" },
    { ticker: "MEDANTA", name: "Global Health (Medanta)", sector: "Healthcare" },
    { ticker: "METROPOLIS", name: "Metropolis Healthcare", sector: "Healthcare" },
    { ticker: "MFSL", name: "Max Financial Services", sector: "Insurance" },
    { ticker: "MOTHERSON", name: "Samvardhana Motherson", sector: "Auto" },
    { ticker: "NATCOPHARM", name: "Natco Pharma", sector: "Pharma" },
    { ticker: "NAUKRI", name: "Info Edge (Naukri)", sector: "IT" },
    { ticker: "NAZARA", name: "Nazara Technologies", sector: "IT" },
    { ticker: "NETWORK18", name: "Network18 Media", sector: "Consumer" },
    { ticker: "NHPC", name: "NHPC", sector: "Power" },
    { ticker: "NIACL", name: "New India Assurance", sector: "Insurance" },
    { ticker: "OLECTRA", name: "Olectra Greentech", sector: "Auto" },
    { ticker: "PNBHOUSING", name: "PNB Housing Finance", sector: "Financial Services" },
    { ticker: "POLYMED", name: "Poly Medicure", sector: "Healthcare" },
    { ticker: "PPLPHARMA", name: "Piramal Pharma", sector: "Pharma" },
    { ticker: "PRESTIGE", name: "Prestige Estates", sector: "Realty" },
    { ticker: "PRINCEPIPE", name: "Prince Pipes & Fittings", sector: "Consumer" },
    { ticker: "RADICO", name: "Radico Khaitan", sector: "FMCG" },
    { ticker: "RAILTEL", name: "RailTel Corporation", sector: "IT" },
    { ticker: "RAINBOW", name: "Rainbow Children Medicare", sector: "Healthcare" },
    { ticker: "RAJESHEXPO", name: "Rajesh Exports", sector: "Consumer" },
    { ticker: "RKFORGE", name: "Ramkrishna Forgings", sector: "Capital Goods" },
    { ticker: "ROUTE", name: "Route Mobile", sector: "IT" },
    { ticker: "RVNL", name: "Rail Vikas Nigam", sector: "Infra" },
    { ticker: "SAPPHIRE", name: "Sapphire Foods India", sector: "Consumer" },
    { ticker: "SBCARDS", name: "SBI Cards & Payment Services", sector: "Financial Services" },
    { ticker: "SHRIRAMFIN", name: "Shriram Finance", sector: "NBFC" },
    { ticker: "SIGNATURE", name: "Signatureglobal India", sector: "Realty" },
    { ticker: "SJVN", name: "SJVN", sector: "Power" },
    { ticker: "SOLARA", name: "Solara Active Pharma", sector: "Pharma" },
    { ticker: "SONACOMS", name: "Sona BLW Precision", sector: "Auto" },
    { ticker: "STARHEALTH", name: "Star Health & Allied Insurance", sector: "Insurance" },
    { ticker: "SUMICHEM", name: "Sumitomo Chemical India", sector: "Chemicals" },
    { ticker: "SUNDARMFIN", name: "Sundaram Finance", sector: "NBFC" },
    { ticker: "SUPREMEIND", name: "Supreme Industries", sector: "Consumer" },
    { ticker: "SWSOLAR", name: "Sterling & Wilson Renewable", sector: "Power" },
    { ticker: "TATACOMM", name: "Tata Communications", sector: "Telecom" },
    { ticker: "TATAINVEST", name: "Tata Investment Corp", sector: "Financial Services" },
    { ticker: "TATATECH", name: "Tata Technologies", sector: "IT" },
    { ticker: "TEAMLEASE", name: "TeamLease Services", sector: "Consumer" },
    { ticker: "TIINDIA", name: "Tube Investments of India", sector: "Auto" },
    { ticker: "TIMKEN", name: "Timken India", sector: "Capital Goods" },
    { ticker: "TRIDENT", name: "Trident", sector: "Consumer" },
    { ticker: "TRIVENI", name: "Triveni Turbine", sector: "Capital Goods" },
    { ticker: "UCOBANK", name: "UCO Bank", sector: "Banking" },
    { ticker: "UJJIVANSFB", name: "Ujjivan Small Finance Bank", sector: "Banking" },
    { ticker: "UTIAMC", name: "UTI Asset Management", sector: "Financial Services" },
    { ticker: "VAIBHAVGBL", name: "Vaibhav Global", sector: "Consumer" },
    { ticker: "VEDL", name: "Vedanta", sector: "Metals" },
    { ticker: "VGUARD", name: "V-Guard Industries", sector: "Consumer" },
    { ticker: "VINATIORGA", name: "Vinati Organics", sector: "Chemicals" },
    { ticker: "VSTIND", name: "VST Industries", sector: "FMCG" },
    { ticker: "WELCORP", name: "Welspun Corp", sector: "Metals" },
    { ticker: "WESTLIFE", name: "Westlife Foodworld (McDonalds)", sector: "Consumer" },
    { ticker: "WHIRLPOOL", name: "Whirlpool of India", sector: "Consumer" },
    { ticker: "YESBANK", name: "Yes Bank", sector: "Banking" },
    { ticker: "ZFCVINDIA", name: "ZF Commercial Vehicle", sector: "Auto" },
    { ticker: "ZOMATO", name: "Zomato", sector: "IT" },
    { ticker: "ZYDUSWELL", name: "Zydus Wellness", sector: "FMCG" },
];

export function buildNifty500List(): N500Entry[] {
    const list: N500Entry[] = [];

    // NIFTY200 entries
    for (const [ticker, info] of Object.entries(NIFTY200)) {
        list.push({
            ticker,
            name: info.name,
            sector: info.sector,
            category: NIFTY50_TICKERS.has(ticker) ? "Nifty 50" : "Nifty Next 50",
        });
    }

    // Extended entries (deduplicate against NIFTY200)
    const existing = new Set(list.map((e) => e.ticker));
    for (const entry of EXTENDED_COMPANIES) {
        if (existing.has(entry.ticker)) continue;
        list.push({ ...entry, category: "Midcap 150" });
    }

    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
}

export const NIFTY500_LIST = buildNifty500List();
