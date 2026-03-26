/**
 * Nifty 200 company registry — sourced from NSE official constituent list.
 * Reuse this file whenever the Nifty 200 universe changes.
 *
 * Structure mirrors nifty50.ts: each entry has bse, nse (Yahoo Finance symbol),
 * name, and sector. The key is a short internal ticker used across the app.
 */
export interface CompanyInfo {
    bse: number;
    nse: string;
    name: string;
    sector: string;
}

export const NIFTY200: Record<string, CompanyInfo> = {
    // ── Financial Services ──────────────────────────────────────────────────────
    "360ONE": { bse: 542772, nse: "360ONE.NS", name: "360 ONE WAM", sector: "Financial Services" },
    AUBANK: { bse: 540611, nse: "AUBANK.NS", name: "AU Small Finance Bank", sector: "Financial Services" },
    ABCAPITAL: { bse: 540691, nse: "ABCAPITAL.NS", name: "Aditya Birla Capital", sector: "Financial Services" },
    AXISBANK: { bse: 532215, nse: "AXISBANK.NS", name: "Axis Bank", sector: "Banking" },
    BSE: { bse: 543257, nse: "BSE.NS", name: "BSE", sector: "Financial Services" },
    BAJAJ:        { bse: 500034, nse: "BAJFINANCE.NS", name: "Bajaj Finance",                     sector: "NBFC" },
    BAJAJFINSV: { bse: 532978, nse: "BAJAJFINSV.NS", name: "Bajaj Finserv", sector: "NBFC" },
    BAJAJHLDNG: { bse: 500490, nse: "BAJAJHLDNG.NS", name: "Bajaj Holdings & Investment", sector: "Financial Services" },
    BAJAJHFL: { bse: 544310, nse: "BAJAJHFL.NS", name: "Bajaj Housing Finance", sector: "Financial Services" },
    BANKBARODA: { bse: 532134, nse: "BANKBARODA.NS", name: "Bank of Baroda", sector: "Banking" },
    BANKINDIA: { bse: 532149, nse: "BANKINDIA.NS", name: "Bank of India", sector: "Banking" },
    CANBK: { bse: 532483, nse: "CANBK.NS", name: "Canara Bank", sector: "Banking" },
    CHOLAFIN: { bse: 511243, nse: "CHOLAFIN.NS", name: "Cholamandalam Investment & Finance", sector: "NBFC" },
    FEDERALBNK: { bse: 500469, nse: "FEDERALBNK.NS", name: "Federal Bank", sector: "Banking" },
    HDFCAMC: { bse: 541729, nse: "HDFCAMC.NS", name: "HDFC Asset Management", sector: "Financial Services" },
    HDFC:         { bse: 500180, nse: "HDFCBANK.NS",   name: "HDFC Bank",                        sector: "Banking" },
    HDFCLIFE: { bse: 540777, nse: "HDFCLIFE.NS", name: "HDFC Life Insurance", sector: "Insurance" },
    HUDCO: { bse: 540530, nse: "HUDCO.NS", name: "HUDCO", sector: "Financial Services" },
    ICICI:        { bse: 532174, nse: "ICICIBANK.NS",  name: "ICICI Bank",                       sector: "Banking" },
    ICICIGI: { bse: 540716, nse: "ICICIGI.NS", name: "ICICI Lombard General Insurance", sector: "Insurance" },
    IDFCFIRSTB: { bse: 539437, nse: "IDFCFIRSTB.NS", name: "IDFC First Bank", sector: "Banking" },
    INDIANB: { bse: 532814, nse: "INDIANB.NS", name: "Indian Bank", sector: "Banking" },
    IRFC: { bse: 543257, nse: "IRFC.NS", name: "Indian Railway Finance Corp", sector: "Financial Services" },
    IREDA: { bse: 544200, nse: "IREDA.NS", name: "Indian Renewable Energy Dev Agency", sector: "Financial Services" },
    INDUSINDBK: { bse: 532187, nse: "INDUSINDBK.NS", name: "IndusInd Bank", sector: "Banking" },
    JIOFIN: { bse: 543940, nse: "JIOFIN.NS", name: "Jio Financial Services", sector: "Financial Services" },
    KOTAKBANK: { bse: 500247, nse: "KOTAKBANK.NS", name: "Kotak Mahindra Bank", sector: "Banking" },
    LTF: { bse: 533519, nse: "LTF.NS", name: "L&T Finance", sector: "Financial Services" },
    LICHSGFIN: { bse: 500253, nse: "LICHSGFIN.NS", name: "LIC Housing Finance", sector: "Financial Services" },
    LICI: { bse: 543526, nse: "LICI.NS", name: "Life Insurance Corporation", sector: "Insurance" },
    MMFIN: { bse: 532720, nse: "M&MFIN.NS", name: "Mahindra & Mahindra Financial", sector: "NBFC" },
    MFSL: { bse: 500271, nse: "MFSL.NS", name: "Max Financial Services", sector: "Insurance" },
    MOTILALOFS: { bse: 532892, nse: "MOTILALOFS.NS", name: "Motilal Oswal Financial Services", sector: "Financial Services" },
    MUTHOOTFIN: { bse: 533398, nse: "MUTHOOTFIN.NS", name: "Muthoot Finance", sector: "NBFC" },
    PAYTM: { bse: 543396, nse: "PAYTM.NS", name: "One 97 Communications (Paytm)", sector: "Financial Services" },
    POLICYBZR: { bse: 543390, nse: "POLICYBZR.NS", name: "PB Fintech (PolicyBazaar)", sector: "Financial Services" },
    PFC: { bse: 532810, nse: "PFC.NS", name: "Power Finance Corporation", sector: "Financial Services" },
    PNB: { bse: 532461, nse: "PNB.NS", name: "Punjab National Bank", sector: "Banking" },
    RECLTD: { bse: 532955, nse: "RECLTD.NS", name: "REC", sector: "Financial Services" },
    SBICARD: { bse: 541557, nse: "SBICARD.NS", name: "SBI Cards & Payment Services", sector: "Financial Services" },
    SBILIFE: { bse: 540719, nse: "SBILIFE.NS", name: "SBI Life Insurance", sector: "Insurance" },
    SBI:          { bse: 500112, nse: "SBIN.NS",      name: "State Bank of India",               sector: "Banking" },
    SHRIRAMFIN: { bse: 511218, nse: "SHRIRAMFIN.NS", name: "Shriram Finance", sector: "NBFC" },
    UNIONBANK: { bse: 532477, nse: "UNIONBANK.NS", name: "Union Bank of India", sector: "Banking" },
    YESBANK: { bse: 532648, nse: "YESBANK.NS", name: "Yes Bank", sector: "Banking" },
    NAUKRI: { bse: 532777, nse: "NAUKRI.NS", name: "Info Edge (Naukri)", sector: "Financial Services" },

    // ── Information Technology ──────────────────────────────────────────────────
    TCS: { bse: 532540, nse: "TCS.NS", name: "Tata Consultancy Services", sector: "IT" },
    INFOSYS:      { bse: 500209, nse: "INFY.NS",      name: "Infosys",                           sector: "IT" },
    HCLTECH: { bse: 532281, nse: "HCLTECH.NS", name: "HCL Technologies", sector: "IT" },
    WIPRO: { bse: 507685, nse: "WIPRO.NS", name: "Wipro", sector: "IT" },
    TECHM: { bse: 532755, nse: "TECHM.NS", name: "Tech Mahindra", sector: "IT" },
    LTIM:         { bse: 540005, nse: "LTIM.NS",      name: "LTIMindtree",                       sector: "IT" },
    COFORGE: { bse: 532541, nse: "COFORGE.NS", name: "Coforge", sector: "IT" },
    MPHASIS: { bse: 526299, nse: "MPHASIS.NS", name: "Mphasis", sector: "IT" },
    PERSISTENT: { bse: 533179, nse: "PERSISTENT.NS", name: "Persistent Systems", sector: "IT" },
    KPITTECH: { bse: 542651, nse: "KPITTECH.NS", name: "KPIT Technologies", sector: "IT" },
    OFSS: { bse: 532466, nse: "OFSS.NS", name: "Oracle Financial Services Software", sector: "IT" },
    TATAELXSI: { bse: 500408, nse: "TATAELXSI.NS", name: "Tata Elxsi", sector: "IT" },
    TATATECH: { bse: 544028, nse: "TATATECH.NS", name: "Tata Technologies", sector: "IT" },

    // ── Automobile & Auto Components ────────────────────────────────────────────
    MARUTI: { bse: 532500, nse: "MARUTI.NS", name: "Maruti Suzuki India", sector: "Auto" },
    TATAMOTORS: { bse: 500570, nse: "TATAMOTORS.NS", name: "Tata Motors", sector: "Auto" },
    MM: { bse: 500520, nse: "M&M.NS", name: "Mahindra & Mahindra", sector: "Auto" },
    BAJAJAUTO:    { bse: 532977, nse: "BAJAJ-AUTO.NS", name: "Bajaj Auto",                       sector: "Auto" },
    EICHERMOT: { bse: 505200, nse: "EICHERMOT.NS", name: "Eicher Motors", sector: "Auto" },
    HEROMOTOCO: { bse: 500182, nse: "HEROMOTOCO.NS", name: "Hero MotoCorp", sector: "Auto" },
    TVSMOTOR: { bse: 532343, nse: "TVSMOTOR.NS", name: "TVS Motor", sector: "Auto" },
    BHARATFORG: { bse: 500493, nse: "BHARATFORG.NS", name: "Bharat Forge", sector: "Auto" },
    BOSCHLTD: { bse: 500530, nse: "BOSCHLTD.NS", name: "Bosch", sector: "Auto" },
    EXIDEIND: { bse: 500086, nse: "EXIDEIND.NS", name: "Exide Industries", sector: "Auto" },
    HYUNDAI: { bse: 544274, nse: "HYUNDAI.NS", name: "Hyundai Motor India", sector: "Auto" },
    MRF: { bse: 500290, nse: "MRF.NS", name: "MRF", sector: "Auto" },
    MOTHERSON: { bse: 517334, nse: "MOTHERSON.NS", name: "Samvardhana Motherson International", sector: "Auto" },
    SONACOMS: { bse: 543300, nse: "SONACOMS.NS", name: "Sona BLW Precision Forgings", sector: "Auto" },
    TMPV: { bse: 500570, nse: "TMPV.NS", name: "Tata Motors Passenger Vehicles", sector: "Auto" },
    TIINDIA: { bse: 540762, nse: "TIINDIA.NS", name: "Tube Investments of India", sector: "Auto" },
    ASHOKLEY: { bse: 500477, nse: "ASHOKLEY.NS", name: "Ashok Leyland", sector: "Auto" },

    // ── Oil, Gas & Energy ───────────────────────────────────────────────────────
    RELIANCE: { bse: 500325, nse: "RELIANCE.NS", name: "Reliance Industries", sector: "Oil & Gas" },
    ONGC: { bse: 500312, nse: "ONGC.NS", name: "ONGC", sector: "Oil & Gas" },
    BPCL: { bse: 500547, nse: "BPCL.NS", name: "Bharat Petroleum", sector: "Oil & Gas" },
    IOC: { bse: 530965, nse: "IOC.NS", name: "Indian Oil Corporation", sector: "Oil & Gas" },
    HINDPETRO: { bse: 500104, nse: "HINDPETRO.NS", name: "Hindustan Petroleum", sector: "Oil & Gas" },
    GAIL: { bse: 532155, nse: "GAIL.NS", name: "GAIL (India)", sector: "Oil & Gas" },
    OIL: { bse: 533106, nse: "OIL.NS", name: "Oil India", sector: "Oil & Gas" },
    ATGL: { bse: 542066, nse: "ATGL.NS", name: "Adani Total Gas", sector: "Oil & Gas" },
    IGL: { bse: 532514, nse: "IGL.NS", name: "Indraprastha Gas", sector: "Oil & Gas" },
    COALINDIA: { bse: 533278, nse: "COALINDIA.NS", name: "Coal India", sector: "Mining" },

    // ── Power & Utilities ───────────────────────────────────────────────────────
    NTPC: { bse: 532555, nse: "NTPC.NS", name: "NTPC", sector: "Power" },
    POWERGRID: { bse: 532898, nse: "POWERGRID.NS", name: "Power Grid Corporation", sector: "Power" },
    ADANIENSOL: { bse: 539254, nse: "ADANIENSOL.NS", name: "Adani Energy Solutions", sector: "Power" },
    ADANIGREEN: { bse: 541450, nse: "ADANIGREEN.NS", name: "Adani Green Energy", sector: "Power" },
    ADANIPOWER: { bse: 533096, nse: "ADANIPOWER.NS", name: "Adani Power", sector: "Power" },
    NHPC: { bse: 533098, nse: "NHPC.NS", name: "NHPC", sector: "Power" },
    NTPCGREEN: { bse: 544464, nse: "NTPCGREEN.NS", name: "NTPC Green Energy", sector: "Power" },
    TATAPOWER: { bse: 500400, nse: "TATAPOWER.NS", name: "Tata Power", sector: "Power" },
    TORNTPOWER: { bse: 532779, nse: "TORNTPOWER.NS", name: "Torrent Power", sector: "Power" },
    JSWENERGY: { bse: 533148, nse: "JSWENERGY.NS", name: "JSW Energy", sector: "Power" },

    // ── Metals & Mining ─────────────────────────────────────────────────────────
    TATASTEEL: { bse: 500470, nse: "TATASTEEL.NS", name: "Tata Steel", sector: "Metals" },
    JSWSTEEL: { bse: 500228, nse: "JSWSTEEL.NS", name: "JSW Steel", sector: "Metals" },
    HINDALCO: { bse: 500440, nse: "HINDALCO.NS", name: "Hindalco Industries", sector: "Metals" },
    VEDL: { bse: 500295, nse: "VEDL.NS", name: "Vedanta", sector: "Metals" },
    HINDZINC: { bse: 500188, nse: "HINDZINC.NS", name: "Hindustan Zinc", sector: "Metals" },
    JINDALSTEL: { bse: 532286, nse: "JINDALSTEL.NS", name: "Jindal Steel", sector: "Metals" },
    NMDC: { bse: 526371, nse: "NMDC.NS", name: "NMDC", sector: "Metals" },
    NATIONALUM: { bse: 532234, nse: "NATIONALUM.NS", name: "National Aluminium", sector: "Metals" },
    SAIL: { bse: 500113, nse: "SAIL.NS", name: "Steel Authority of India", sector: "Metals" },

    // ── Healthcare & Pharma ─────────────────────────────────────────────────────
    SUNPHARMA: { bse: 524715, nse: "SUNPHARMA.NS", name: "Sun Pharmaceutical", sector: "Pharma" },
    DRREDDY: { bse: 500124, nse: "DRREDDY.NS", name: "Dr. Reddy's Laboratories", sector: "Pharma" },
    CIPLA: { bse: 500087, nse: "CIPLA.NS", name: "Cipla", sector: "Pharma" },
    DIVISLAB: { bse: 532488, nse: "DIVISLAB.NS", name: "Divi's Laboratories", sector: "Pharma" },
    APOLLOHOSP: { bse: 508869, nse: "APOLLOHOSP.NS", name: "Apollo Hospitals", sector: "Healthcare" },
    ALKEM: { bse: 539523, nse: "ALKEM.NS", name: "Alkem Laboratories", sector: "Pharma" },
    AUROPHARMA: { bse: 524804, nse: "AUROPHARMA.NS", name: "Aurobindo Pharma", sector: "Pharma" },
    BIOCON: { bse: 532523, nse: "BIOCON.NS", name: "Biocon", sector: "Pharma" },
    FORTIS: { bse: 532843, nse: "FORTIS.NS", name: "Fortis Healthcare", sector: "Healthcare" },
    GLENMARK: { bse: 532296, nse: "GLENMARK.NS", name: "Glenmark Pharmaceuticals", sector: "Pharma" },
    LUPIN: { bse: 500257, nse: "LUPIN.NS", name: "Lupin", sector: "Pharma" },
    MANKIND: { bse: 543904, nse: "MANKIND.NS", name: "Mankind Pharma", sector: "Pharma" },
    MAXHEALTH: { bse: 543220, nse: "MAXHEALTH.NS", name: "Max Healthcare Institute", sector: "Healthcare" },
    TORNTPHARM: { bse: 500420, nse: "TORNTPHARM.NS", name: "Torrent Pharmaceuticals", sector: "Pharma" },
    ZYDUSLIFE: { bse: 532321, nse: "ZYDUSLIFE.NS", name: "Zydus Lifesciences", sector: "Pharma" },

    // ── FMCG ────────────────────────────────────────────────────────────────────
    HUL:          { bse: 500696, nse: "HINDUNILVR.NS", name: "Hindustan Unilever",              sector: "FMCG" },
    ITC: { bse: 500875, nse: "ITC.NS", name: "ITC", sector: "FMCG" },
    NESTLEIND: { bse: 500790, nse: "NESTLEIND.NS", name: "Nestle India", sector: "FMCG" },
    TATACONSUM: { bse: 500800, nse: "TATACONSUM.NS", name: "Tata Consumer Products", sector: "FMCG" },
    BRITANNIA: { bse: 500825, nse: "BRITANNIA.NS", name: "Britannia Industries", sector: "FMCG" },
    COLPAL: { bse: 500830, nse: "COLPAL.NS", name: "Colgate Palmolive India", sector: "FMCG" },
    DABUR: { bse: 500096, nse: "DABUR.NS", name: "Dabur India", sector: "FMCG" },
    GODREJCP: { bse: 532424, nse: "GODREJCP.NS", name: "Godrej Consumer Products", sector: "FMCG" },
    GODFRYPHLP: { bse: 500163, nse: "GODFRYPHLP.NS", name: "Godfrey Phillips India", sector: "FMCG" },
    MARICO: { bse: 531642, nse: "MARICO.NS", name: "Marico", sector: "FMCG" },
    PATANJALI: { bse: 500368, nse: "PATANJALI.NS", name: "Patanjali Foods", sector: "FMCG" },
    UNITDSPR: { bse: 532432, nse: "UNITDSPR.NS", name: "United Spirits", sector: "FMCG" },
    VBL: { bse: 540180, nse: "VBL.NS", name: "Varun Beverages", sector: "FMCG" },

    // ── Consumer Durables & Services ────────────────────────────────────────────
    TITAN: { bse: 500114, nse: "TITAN.NS", name: "Titan Company", sector: "Consumer" },
    ASIANPAINT: { bse: 500820, nse: "ASIANPAINT.NS", name: "Asian Paints", sector: "Consumer" },
    HAVELLS: { bse: 517354, nse: "HAVELLS.NS", name: "Havells India", sector: "Consumer" },
    BLUESTARCO: { bse: 500067, nse: "BLUESTARCO.NS", name: "Blue Star", sector: "Consumer" },
    DIXON: { bse: 540699, nse: "DIXON.NS", name: "Dixon Technologies", sector: "Consumer" },
    KALYANKJIL: { bse: 543278, nse: "KALYANKJIL.NS", name: "Kalyan Jewellers India", sector: "Consumer" },
    VOLTAS: { bse: 500575, nse: "VOLTAS.NS", name: "Voltas", sector: "Consumer" },
    PAGEIND: { bse: 532827, nse: "PAGEIND.NS", name: "Page Industries", sector: "Consumer" },
    DMART: { bse: 540376, nse: "DMART.NS", name: "Avenue Supermarts (DMart)", sector: "Consumer" },
    ETERNAL: { bse: 543320, nse: "ETERNAL.NS", name: "Eternal (Zomato)", sector: "Consumer" },
    NYKAA: { bse: 543384, nse: "NYKAA.NS", name: "FSN E-Commerce (Nykaa)", sector: "Consumer" },
    INDHOTEL: { bse: 500850, nse: "INDHOTEL.NS", name: "Indian Hotels", sector: "Consumer" },
    IRCTC: { bse: 542830, nse: "IRCTC.NS", name: "IRCTC", sector: "Consumer" },
    ITCHOTELS: { bse: 544285, nse: "ITCHOTELS.NS", name: "ITC Hotels", sector: "Consumer" },
    JUBLFOOD: { bse: 533155, nse: "JUBLFOOD.NS", name: "Jubilant Foodworks", sector: "Consumer" },
    SWIGGY: { bse: 544285, nse: "SWIGGY.NS", name: "Swiggy", sector: "Consumer" },
    TRENT: { bse: 500251, nse: "TRENT.NS", name: "Trent", sector: "Consumer" },
    VMM: { bse: 544295, nse: "VMM.NS", name: "Vishal Mega Mart", sector: "Consumer" },

    // ── Telecom ─────────────────────────────────────────────────────────────────
    BHARTI:       { bse: 532454, nse: "BHARTIARTL.NS", name: "Bharti Airtel",                   sector: "Telecom" },
    BHARTIHEXA: { bse: 544077, nse: "BHARTIHEXA.NS", name: "Bharti Hexacom", sector: "Telecom" },
    INDUSTOWER: { bse: 534816, nse: "INDUSTOWER.NS", name: "Indus Towers", sector: "Telecom" },
    TATACOMM: { bse: 500483, nse: "TATACOMM.NS", name: "Tata Communications", sector: "Telecom" },
    IDEA: { bse: 532822, nse: "IDEA.NS", name: "Vodafone Idea", sector: "Telecom" },

    // ── Construction & Infra ────────────────────────────────────────────────────
    LT: { bse: 500510, nse: "LT.NS", name: "Larsen & Toubro", sector: "Infra" },
    ADANIENT: { bse: 512599, nse: "ADANIENT.NS", name: "Adani Enterprises", sector: "Conglomerate" },
    ADANIPORTS: { bse: 532921, nse: "ADANIPORTS.NS", name: "Adani Ports & SEZ", sector: "Infra" },
    IRB: { bse: 532947, nse: "IRB.NS", name: "IRB Infrastructure Developers", sector: "Infra" },
    RVNL: { bse: 542649, nse: "RVNL.NS", name: "Rail Vikas Nigam", sector: "Infra" },
    CONCOR: { bse: 531344, nse: "CONCOR.NS", name: "Container Corporation of India", sector: "Infra" },
    GMRAIRPORT: { bse: 542309, nse: "GMRAIRPORT.NS", name: "GMR Airports", sector: "Infra" },
    INDIGO: { bse: 539448, nse: "INDIGO.NS", name: "InterGlobe Aviation (IndiGo)", sector: "Infra" },

    // ── Construction Materials (Cement) ─────────────────────────────────────────
    ULTRACEMCO: { bse: 532538, nse: "ULTRACEMCO.NS", name: "UltraTech Cement", sector: "Cement" },
    GRASIM: { bse: 500300, nse: "GRASIM.NS", name: "Grasim Industries", sector: "Cement" },
    ACC: { bse: 500410, nse: "ACC.NS", name: "ACC", sector: "Cement" },
    AMBUJACEM: { bse: 500425, nse: "AMBUJACEM.NS", name: "Ambuja Cements", sector: "Cement" },
    SHREECEM: { bse: 500387, nse: "SHREECEM.NS", name: "Shree Cement", sector: "Cement" },

    // ── Capital Goods & Industrials ─────────────────────────────────────────────
    ABB: { bse: 500002, nse: "ABB.NS", name: "ABB India", sector: "Capital Goods" },
    APLAPOLLO: { bse: 533758, nse: "APLAPOLLO.NS", name: "APL Apollo Tubes", sector: "Capital Goods" },
    ASTRAL: { bse: 532830, nse: "ASTRAL.NS", name: "Astral", sector: "Capital Goods" },
    BDL: { bse: 541143, nse: "BDL.NS", name: "Bharat Dynamics", sector: "Capital Goods" },
    BEL: { bse: 500049, nse: "BEL.NS", name: "Bharat Electronics", sector: "Capital Goods" },
    BHEL: { bse: 500103, nse: "BHEL.NS", name: "Bharat Heavy Electricals", sector: "Capital Goods" },
    CGPOWER: { bse: 500093, nse: "CGPOWER.NS", name: "CG Power & Industrial Solutions", sector: "Capital Goods" },
    COCHINSHIP: { bse: 540678, nse: "COCHINSHIP.NS", name: "Cochin Shipyard", sector: "Capital Goods" },
    CUMMINSIND: { bse: 500480, nse: "CUMMINSIND.NS", name: "Cummins India", sector: "Capital Goods" },
    HAL: { bse: 541154, nse: "HAL.NS", name: "Hindustan Aeronautics", sector: "Capital Goods" },
    POWERINDIA: { bse: 543187, nse: "POWERINDIA.NS", name: "Hitachi Energy India", sector: "Capital Goods" },
    KEI: { bse: 517569, nse: "KEI.NS", name: "KEI Industries", sector: "Capital Goods" },
    MAZDOCK: { bse: 543237, nse: "MAZDOCK.NS", name: "Mazagoan Dock Shipbuilders", sector: "Capital Goods" },
    POLYCAB: { bse: 542652, nse: "POLYCAB.NS", name: "Polycab India", sector: "Capital Goods" },
    PREMIERENE: { bse: 544292, nse: "PREMIERENE.NS", name: "Premier Energies", sector: "Capital Goods" },
    SIEMENS: { bse: 500550, nse: "SIEMENS.NS", name: "Siemens", sector: "Capital Goods" },
    ENRIN: { bse: 544416, nse: "ENRIN.NS", name: "Siemens Energy India", sector: "Capital Goods" },
    SUPREMEIND: { bse: 509930, nse: "SUPREMEIND.NS", name: "Supreme Industries", sector: "Capital Goods" },
    SUZLON: { bse: 532667, nse: "SUZLON.NS", name: "Suzlon Energy", sector: "Capital Goods" },
    WAAREEENER: { bse: 544312, nse: "WAAREEENER.NS", name: "Waaree Energies", sector: "Capital Goods" },

    // ── Chemicals ───────────────────────────────────────────────────────────────
    PIDILITIND: { bse: 500331, nse: "PIDILITIND.NS", name: "Pidilite Industries", sector: "Chemicals" },
    COROMANDEL: { bse: 506395, nse: "COROMANDEL.NS", name: "Coromandel International", sector: "Chemicals" },
    PIIND: { bse: 523642, nse: "PIIND.NS", name: "PI Industries", sector: "Chemicals" },
    SRF: { bse: 503806, nse: "SRF.NS", name: "SRF", sector: "Chemicals" },
    SOLARINDS: { bse: 532725, nse: "SOLARINDS.NS", name: "Solar Industries India", sector: "Chemicals" },
    UPL: { bse: 512070, nse: "UPL.NS", name: "UPL", sector: "Chemicals" },

    // ── Realty ──────────────────────────────────────────────────────────────────
    DLF: { bse: 532868, nse: "DLF.NS", name: "DLF", sector: "Realty" },
    GODREJPROP: { bse: 533150, nse: "GODREJPROP.NS", name: "Godrej Properties", sector: "Realty" },
    LODHA: { bse: 543287, nse: "LODHA.NS", name: "Lodha Developers (Macrotech)", sector: "Realty" },
    OBEROIRLTY: { bse: 533273, nse: "OBEROIRLTY.NS", name: "Oberoi Realty", sector: "Realty" },
    PHOENIXLTD: { bse: 503100, nse: "PHOENIXLTD.NS", name: "Phoenix Mills", sector: "Realty" },
    PRESTIGE: { bse: 533261, nse: "PRESTIGE.NS", name: "Prestige Estates Projects", sector: "Realty" },
};

/** Sorted list for dropdown display — searchable by name or ticker */
export const NIFTY200_LIST = Object.entries(NIFTY200)
    .map(([ticker, info]) => ({ ticker, ...info }))
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Hardcoded screener.in URL slugs for Nifty 200 tickers.
 * Bypasses the unreliable search API. Non-listed tickers fall back to search.
 * Uses the NSE symbol from the NIFTY200 registry as the screener slug.
 */
export const SCREENER_SLUGS_200: Record<string, string> = {};
for (const [ticker, info] of Object.entries(NIFTY200)) {
    // Screener uses NSE symbols without the .NS suffix
    const nseSymbol = info.nse.replace(".NS", "");
    SCREENER_SLUGS_200[ticker] = `/company/${nseSymbol}/consolidated/`;
}
