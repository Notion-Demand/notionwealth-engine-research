"use strict";exports.id=8027,exports.ids=[8027],exports.modules={99818:(e,t,a)=>{a.d(t,{Q:()=>s,c:()=>i});var n=a(99064);async function s(e,t,a){let s;let{data:i}=await (0,n.supabaseAdmin)().from("analysis_results").select("payload").eq("company_ticker",e.toUpperCase()).eq("q_prev",t).eq("q_curr",a).order("created_at",{ascending:!1}).limit(1).maybeSingle();if(!i?.payload)return null;let r=i.payload;if("string"==typeof r)try{s=JSON.parse(r)}catch{return null}else s=r;return Array.isArray(s.insights)&&0!==s.insights.length&&Array.isArray(s.earnings_delta)?s:null}async function i(e,t,a,s,i){try{if(!Array.isArray(i.insights)||0===i.insights.length)return"not-cached-empty";let r=t.toUpperCase();await (0,n.supabaseAdmin)().from("analysis_results").delete().eq("company_ticker",r).eq("q_prev",a).eq("q_curr",s);let{data:o}=await (0,n.supabaseAdmin)().from("analysis_results").insert({user_id:e,company_ticker:r,q_prev:a,q_curr:s,payload:i}).select("id").single();return o?.id??"unknown"}catch(e){return console.error("Failed to save analysis result:",e),"unknown"}}},22618:(e,t,a)=>{a.d(t,{Ss:()=>o,fk:()=>n,iL:()=>i,l0:()=>s,mx:()=>r});let n={RELIANCE:{bse:500325,nse:"RELIANCE.NS",name:"Reliance Industries",sector:"Conglomerate"},TCS:{bse:532540,nse:"TCS.NS",name:"Tata Consultancy Services",sector:"IT"},HDFC:{bse:500180,nse:"HDFCBANK.NS",name:"HDFC Bank",sector:"Banking"},BHARTI:{bse:532454,nse:"BHARTIARTL.NS",name:"Bharti Airtel",sector:"Telecom"},ICICI:{bse:532174,nse:"ICICIBANK.NS",name:"ICICI Bank",sector:"Banking"},INFOSYS:{bse:500209,nse:"INFY.NS",name:"Infosys",sector:"IT"},SBI:{bse:500112,nse:"SBIN.NS",name:"State Bank of India",sector:"Banking"},BAJAJ:{bse:500034,nse:"BAJFINANCE.NS",name:"Bajaj Finance",sector:"NBFC"},LT:{bse:500510,nse:"LT.NS",name:"Larsen & Toubro",sector:"Infra"},HUL:{bse:500696,nse:"HINDUNILVR.NS",name:"Hindustan Unilever",sector:"FMCG"},KOTAKBANK:{bse:500247,nse:"KOTAKBANK.NS",name:"Kotak Mahindra Bank",sector:"Banking"},AXISBANK:{bse:532215,nse:"AXISBANK.NS",name:"Axis Bank",sector:"Banking"},ITC:{bse:500875,nse:"ITC.NS",name:"ITC",sector:"FMCG"},HCLTECH:{bse:532281,nse:"HCLTECH.NS",name:"HCL Technologies",sector:"IT"},WIPRO:{bse:507685,nse:"WIPRO.NS",name:"Wipro",sector:"IT"},ULTRACEMCO:{bse:532538,nse:"ULTRACEMCO.NS",name:"UltraTech Cement",sector:"Cement"},ADANIENT:{bse:512599,nse:"ADANIENT.NS",name:"Adani Enterprises",sector:"Conglomerate"},ADANIPORTS:{bse:532921,nse:"ADANIPORTS.NS",name:"Adani Ports & SEZ",sector:"Infra"},TITAN:{bse:500114,nse:"TITAN.NS",name:"Titan Company",sector:"Consumer"},MARUTI:{bse:532500,nse:"MARUTI.NS",name:"Maruti Suzuki",sector:"Auto"},NTPC:{bse:532555,nse:"NTPC.NS",name:"NTPC",sector:"Power"},POWERGRID:{bse:532898,nse:"POWERGRID.NS",name:"Power Grid Corporation",sector:"Power"},ONGC:{bse:500312,nse:"ONGC.NS",name:"ONGC",sector:"Oil & Gas"},TATAMOTORS:{bse:500570,nse:"TATAMOTORS.NS",name:"Tata Motors",sector:"Auto"},TATASTEEL:{bse:500470,nse:"TATASTEEL.NS",name:"Tata Steel",sector:"Metals"},SBILIFE:{bse:540719,nse:"SBILIFE.NS",name:"SBI Life Insurance",sector:"Insurance"},HDFCLIFE:{bse:540777,nse:"HDFCLIFE.NS",name:"HDFC Life Insurance",sector:"Insurance"},ICICIPRULI:{bse:540133,nse:"ICICIPRULI.NS",name:"ICICI Prudential Life",sector:"Insurance"},SUNPHARMA:{bse:524715,nse:"SUNPHARMA.NS",name:"Sun Pharmaceutical",sector:"Pharma"},DRREDDY:{bse:500124,nse:"DRREDDY.NS",name:"Dr. Reddy's Laboratories",sector:"Pharma"},CIPLA:{bse:500087,nse:"CIPLA.NS",name:"Cipla",sector:"Pharma"},ASIANPAINT:{bse:500820,nse:"ASIANPAINT.NS",name:"Asian Paints",sector:"Consumer"},NESTLEIND:{bse:500790,nse:"NESTLEIND.NS",name:"Nestle India",sector:"FMCG"},BAJAJFINSV:{bse:532978,nse:"BAJAJFINSV.NS",name:"Bajaj Finserv",sector:"NBFC"},JSWSTEEL:{bse:500228,nse:"JSWSTEEL.NS",name:"JSW Steel",sector:"Metals"},COALINDIA:{bse:533278,nse:"COALINDIA.NS",name:"Coal India",sector:"Mining"},INDUSINDBK:{bse:532187,nse:"INDUSINDBK.NS",name:"IndusInd Bank",sector:"Banking"},HINDALCO:{bse:500440,nse:"HINDALCO.NS",name:"Hindalco Industries",sector:"Metals"},GRASIM:{bse:500300,nse:"GRASIM.NS",name:"Grasim Industries",sector:"Cement"},TECHM:{bse:532755,nse:"TECHM.NS",name:"Tech Mahindra",sector:"IT"},EICHERMOT:{bse:505200,nse:"EICHERMOT.NS",name:"Eicher Motors",sector:"Auto"},HEROMOTOCO:{bse:500182,nse:"HEROMOTOCO.NS",name:"Hero MotoCorp",sector:"Auto"},TATACONSUM:{bse:500800,nse:"TATACONSUM.NS",name:"Tata Consumer Products",sector:"FMCG"},BRITANNIA:{bse:500825,nse:"BRITANNIA.NS",name:"Britannia Industries",sector:"FMCG"},APOLLOHOSP:{bse:508869,nse:"APOLLOHOSP.NS",name:"Apollo Hospitals",sector:"Healthcare"},DIVISLAB:{bse:532488,nse:"DIVISLAB.NS",name:"Divi's Laboratories",sector:"Pharma"},LTIM:{bse:540005,nse:"LTIM.NS",name:"LTIMindtree",sector:"IT"},MM:{bse:500520,nse:"M&M.NS",name:"Mahindra & Mahindra",sector:"Auto"},BPCL:{bse:500547,nse:"BPCL.NS",name:"Bharat Petroleum",sector:"Oil & Gas"},BAJAJAUTO:{bse:532977,nse:"BAJAJ-AUTO.NS",name:"Bajaj Auto",sector:"Auto"}};Object.entries(n).map(([e,t])=>({ticker:e,...t})).sort((e,t)=>e.name.localeCompare(t.name));let s={Banking:{tickers:["HDFC","ICICI","SBI","KOTAKBANK","AXISBANK","INDUSINDBK"],label:"Banking"},IT:{tickers:["TCS","INFOSYS","HCLTECH","WIPRO","TECHM","LTIM"],label:"IT Services"},Auto:{tickers:["MARUTI","TATAMOTORS","MM","BAJAJAUTO","EICHERMOT","HEROMOTOCO"],label:"Automobiles"},FMCG:{tickers:["HUL","ITC","NESTLEIND","TATACONSUM","BRITANNIA"],label:"FMCG"},Pharma:{tickers:["SUNPHARMA","DRREDDY","CIPLA","DIVISLAB"],label:"Pharmaceuticals"},"Oil & Gas":{tickers:["RELIANCE","ONGC","BPCL"],label:"Oil & Gas"},Metals:{tickers:["TATASTEEL","JSWSTEEL","HINDALCO"],label:"Metals & Mining"},Infra:{tickers:["LT","ADANIPORTS"],label:"Infrastructure"},Insurance:{tickers:["SBILIFE","HDFCLIFE","ICICIPRULI"],label:"Insurance"},Telecom:{tickers:["BHARTI"],label:"Telecom"}},i={HDFC:13.5,ICICI:9.5,SBI:7.5,KOTAKBANK:4,AXISBANK:3.8,INDUSINDBK:1,TCS:15,INFOSYS:7.5,HCLTECH:4.5,WIPRO:2.8,TECHM:1.5,LTIM:1.8,MARUTI:4.2,TATAMOTORS:3,MM:3.8,BAJAJAUTO:2.5,EICHERMOT:1.2,HEROMOTOCO:1,HUL:5.8,ITC:5.5,NESTLEIND:1.8,TATACONSUM:1,BRITANNIA:1.2,SUNPHARMA:4,DRREDDY:1.1,CIPLA:1.2,DIVISLAB:.9,RELIANCE:17,ONGC:3.5,BPCL:1.5,TATASTEEL:1.8,JSWSTEEL:2.3,HINDALCO:1.5,LT:5,ADANIPORTS:3.2,SBILIFE:1.5,HDFCLIFE:1.4,ICICIPRULI:.8,BHARTI:9.5},r={HDFC:"/company/HDFCBANK/consolidated/",ICICI:"/company/ICICIBANK/consolidated/",SBI:"/company/SBIN/consolidated/",KOTAKBANK:"/company/KOTAKBANK/consolidated/",AXISBANK:"/company/AXISBANK/consolidated/",INDUSINDBK:"/company/INDUSINDBK/consolidated/",TCS:"/company/TCS/consolidated/",INFOSYS:"/company/INFY/consolidated/",HCLTECH:"/company/HCLTECH/consolidated/",WIPRO:"/company/WIPRO/consolidated/",TECHM:"/company/TECHM/consolidated/",LTIM:"/company/LTM/consolidated/",MARUTI:"/company/MARUTI/consolidated/",TATAMOTORS:"/company/TMCV/consolidated/",MM:"/company/M&M/consolidated/",BAJAJAUTO:"/company/BAJAJ-AUTO/consolidated/",EICHERMOT:"/company/EICHERMOT/consolidated/",HEROMOTOCO:"/company/HEROMOTOCO/consolidated/",HUL:"/company/HINDUNILVR/consolidated/",ITC:"/company/ITC/consolidated/",NESTLEIND:"/company/NESTLEIND/consolidated/",TATACONSUM:"/company/TATACONSUM/consolidated/",BRITANNIA:"/company/BRITANNIA/consolidated/",SUNPHARMA:"/company/SUNPHARMA/consolidated/",DRREDDY:"/company/DRREDDY/consolidated/",CIPLA:"/company/CIPLA/consolidated/",DIVISLAB:"/company/DIVISLAB/consolidated/",RELIANCE:"/company/RELIANCE/consolidated/",ONGC:"/company/ONGC/consolidated/",BPCL:"/company/BPCL/consolidated/",TATASTEEL:"/company/TATASTEEL/consolidated/",JSWSTEEL:"/company/JSWSTEEL/consolidated/",HINDALCO:"/company/HINDALCO/consolidated/",LT:"/company/LT/consolidated/",ADANIPORTS:"/company/ADANIPORTS/consolidated/",SBILIFE:"/company/SBILIFE/consolidated/",HDFCLIFE:"/company/HDFCLIFE/consolidated/",ICICIPRULI:"/company/ICICIPRULI/consolidated/",BHARTI:"/company/BHARTIARTL/consolidated/",BAJAJ:"/company/BAJFINANCE/consolidated/",BAJAJFINSV:"/company/BAJAJFINSV/consolidated/",ADANIENT:"/company/ADANIENT/consolidated/",TITAN:"/company/TITAN/consolidated/",ASIANPAINT:"/company/ASIANPAINT/consolidated/",NTPC:"/company/NTPC/consolidated/",POWERGRID:"/company/POWERGRID/consolidated/",COALINDIA:"/company/COALINDIA/consolidated/",ULTRACEMCO:"/company/ULTRACEMCO/consolidated/",GRASIM:"/company/GRASIM/consolidated/",APOLLOHOSP:"/company/APOLLOHOSP/consolidated/"};function o(e){let t=e.match(/^Q(\d)_(\d{4})$/);return t?`Q${t[1]} FY${t[2].slice(2)}`:e}},2194:(e,t,a)=>{a.d(t,{M_:()=>k,t5:()=>h});var n=a(11258),s=a(74193),i=a.n(s),r=a(22618),o=a(60758),c=a(99064);let l={type:n.XQ.OBJECT,properties:{section_name:{type:n.XQ.STRING},key_takeaways:{type:n.XQ.ARRAY,items:{type:n.XQ.STRING}},raw_quotes:{type:n.XQ.ARRAY,items:{type:n.XQ.STRING}}},required:["section_name","key_takeaways","raw_quotes"]},d={type:n.XQ.OBJECT,properties:{subtopic:{type:n.XQ.STRING},quote_old:{type:n.XQ.STRING},quote_new:{type:n.XQ.STRING},language_shift:{type:n.XQ.STRING},signal_classification:{type:n.XQ.STRING,format:"enum",enum:["Positive","Negative","Noise"]},signal_score:{type:n.XQ.NUMBER},ui_component_type:{type:n.XQ.STRING,format:"enum",enum:["metric_card","status_warning","quote_expander"]}},required:["subtopic","quote_old","quote_new","language_shift","signal_classification","signal_score","ui_component_type"]},u={type:n.XQ.OBJECT,properties:{section_name:{type:n.XQ.STRING},key_takeaways:{type:n.XQ.ARRAY,items:{type:n.XQ.STRING}},metrics:{type:n.XQ.ARRAY,items:d}},required:["section_name","key_takeaways","metrics"]},m={type:n.XQ.OBJECT,properties:{score:{type:n.XQ.NUMBER},reasoning:{type:n.XQ.STRING}},required:["score","reasoning"]},p={type:n.XQ.OBJECT,properties:{bullets:{type:n.XQ.ARRAY,items:{type:n.XQ.STRING}}},required:["bullets"]},g={type:n.XQ.OBJECT,properties:{revenue:{type:n.XQ.STRING},revenue_growth:{type:n.XQ.STRING},ebitda_margin:{type:n.XQ.STRING},ebitda_change:{type:n.XQ.STRING},pat:{type:n.XQ.STRING},pat_growth:{type:n.XQ.STRING},product_highlight:{type:n.XQ.STRING}},required:[]},I=`You are a financial data extractor. Extract exactly these numbers from the earnings call transcript — nothing more.

For each field:
- revenue: consolidated revenue/sales figure for the current quarter (e.g. "₹98,000 cr" or "$4.2bn")
- revenue_growth: YoY growth stated or implied (e.g. "+11% YoY")
- ebitda_margin: EBITDA margin % for the quarter (e.g. "28.8%")
- ebitda_change: change in EBITDA margin vs same quarter last year (e.g. "+150 bps YoY")
- pat: net profit / PAT for the quarter (e.g. "₹19,260 cr")
- pat_growth: PAT YoY growth (e.g. "+15% YoY")
- product_highlight: one-line segment/product mix signal (e.g. "Digital: 55% of EBITDA" or "Exports: 62% of revenue")

Rules:
- If a figure is NOT explicitly stated, leave the field as an empty string — do NOT estimate.
- Use the exact number management cited, not analyst questions.
- Prefer consolidated figures over standalone.
- Keep values short (under 20 chars each).`;async function A(e,t,a,s="gemini-2.5-flash-lite"){let i=(function(){let e=process.env.GOOGLE_API_KEY;if(!e)throw Error("GOOGLE_API_KEY not set");return new n.$D(e)})().getGenerativeModel({model:s,systemInstruction:e,generationConfig:{responseMimeType:"application/json",responseSchema:a,temperature:0}}),r=new Promise((e,t)=>setTimeout(()=>t(Error("Gemini agent timed out")),45e3));return JSON.parse((await Promise.race([i.generateContent(t),r])).response.text())}let y="transcripts";async function h(e,t){let a=`${e}_${t}.pdf`.toLowerCase(),n=[],s=0;for(;;){let{data:e,error:t}=await (0,c.supabaseAdmin)().storage.from(y).list("",{limit:100,offset:s});if(t)throw Error(`Storage list failed: ${t.message}`);if(!e||0===e.length)break;n.push(...e),s+=e.length}let i=n.find(e=>e.name.toLowerCase()===a);if(i)return i.name;let r=n.filter(t=>t.name.toUpperCase().startsWith(e.toUpperCase()+"_")).map(e=>e.name).sort(),o=r.length>0?` Available for ${e}: ${r.join(", ")}`:"";throw Error(`PDF not found: ${e} ${t}.${o}`)}async function T(e){let{data:t,error:a}=await (0,c.supabaseAdmin)().storage.from(y).download(e);if(a||!t)throw Error(`Storage download failed for ${e}: ${a?.message}`);let n=Buffer.from(await t.arrayBuffer()),s=n.slice(0,5).toString("ascii");if(console.log(`[Pipeline] ${e}: ${n.length} bytes, header="${s}"`),0===n.length)throw Error(`${e} is empty — delete it from storage and re-request the ticker`);if(!s.startsWith("%PDF"))throw Error(`${e} is not a valid PDF (header: "${s}") — delete it from storage and re-request the ticker`);try{let t=(await i()(n)).text;return t.length>12e4&&console.log(`[Pipeline] ${e}: ${t.length} chars → truncated to 120000`),t.slice(0,12e4)}catch(t){throw Error(`${e} could not be parsed (${t instanceof Error?t.message:t}). The stored PDF appears to be corrupted. Delete it from Supabase storage and re-request the ticker.`)}}function f(e){let t=e.match(/^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$/i);return t?{company:t[1].toUpperCase(),quarter:`Q${t[2]}_${t[3]}`}:null}let N={"Revenue & Growth":`You are a senior equity research analyst specializing in revenue quality and growth decomposition.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Volume vs Realisation split** — volume growth %, realisation/price per unit trends, ARPU, tonnage
2. **Pricing Power** — tariff hikes, price increases, ability to pass costs, contract pricing
3. **Customer & Subscriber Trends** — additions, churn, retention, wallet share, key customer wins
4. **Product / Segment / Geography Mix** — which products/segments/geographies drove growth
5. **New Market Expansion** — new customers, new geographies, new products, new industries
6. **Revenue Visibility** — order book, backlog, long-term contracts, guidance specificity

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Separate volume-driven growth from price/realisation-driven growth wherever discussed
- Flag new customer or geography mentions with detail — even brief ones
- Provide 3-5 key takeaways on revenue quality and growth trajectory`,"Margins & Profitability":`You are a senior financial analyst specializing in profitability and margin structure analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Gross / Contribution Margin** — product-level margins, spread between realisation and variable cost
2. **EBITDA Margin** — level, YoY/QoQ change, trajectory, guidance
3. **PAT Margin & Net Profitability** — PAT, PAT margin, tax rate, minority interest, EPS
4. **Operating Leverage** — how margins behave as volumes change, fixed vs variable cost structure
5. **Margin Guidance** — explicit margin targets, management's expected margin range, confidence level
6. **One-time vs Recurring** — items that inflate/deflate reported margins, normalized margin discussion

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Always note the specific numbers discussed (e.g., "28.8% EBITDA vs 27.3% PY")
- Flag management's comfort zone / target range if stated
- Provide 3-5 key takeaways on profitability trajectory and margin sustainability`,"Cost Structure":`You are a senior industrial analyst specializing in cost structure and operational efficiency.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **Raw Material / Input Costs** — commodity prices (steel, crude, chemicals), % of revenue, price pass-through mechanisms, lag effects
2. **Power & Energy Costs** — energy tariffs, captive power, solar/renewable savings, fuel costs
3. **Labour & Employee Costs** — headcount, wage inflation, productivity, restructuring
4. **Supply Chain & Procurement** — vendor concentration, logistics costs, import/export duties, sourcing changes
5. **Cost Reduction Initiatives** — specific programs, quantified savings, timelines, automation
6. **Fixed Cost Absorption** — how utilization levels affect per-unit costs, break-even analysis

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Quantify cost savings wherever management provides numbers
- Note whether cost pressures are structural or cyclical/temporary
- Provide 3-5 key takeaways on cost structure and efficiency trajectory`,"CapEx & Balance Sheet":`You are a senior credit analyst specializing in capital allocation and balance sheet analysis.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **CapEx Plans** — quantum, projects, phasing, modular/greenfield/brownfield, maintenance vs growth
2. **Capacity Utilisation** — current utilization %, targets, timeline to full capacity
3. **Debt & Leverage** — net debt, debt/EBITDA, repayment schedule, refinancing, cost of debt
4. **Free Cash Flow** — FCF generation, conversion rate, working capital changes
5. **Capital Allocation** — dividends, buybacks, M&A, stated priorities for deployment
6. **Balance Sheet Strength** — liquidity buffers, covenants, credit rating, contingent liabilities

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Flag any capex decisions that were deferred, accelerated, or cancelled vs prior guidance
- Note both the investment and the expected return/payback period if mentioned
- Provide 3-5 key takeaways on capital allocation discipline and balance sheet trajectory`,"Macro & Risk":`You are a senior risk analyst specializing in macro-level threats and systemic risk assessment.

Analyze the earnings call transcript and extract ALL discussions related to:
1. **FX & Commodity Exposure** — currency impact, hedging, geographic revenue split, commodity price risks
2. **Geopolitical & Trade Risks** — tariffs, sanctions, supply chain disruption, country concentration
3. **Regulatory & Policy** — new regulations, government schemes, spectrum/licensing, ESG compliance
4. **Competitive Dynamics** — market share shifts, new entrants, pricing wars, industry consolidation
5. **Demand Environment** — sector tailwinds/headwinds, customer industry health, macro indicators
6. **Management's Own Risk Language** — cautionary phrasing, "subject to", conditional guidance, scenario framing

RULES:
- Extract VERBATIM quotes (do NOT paraphrase). Include speaker attribution.
- Pay EXTRA attention to Q&A — analysts often surface risks management avoids in prepared remarks
- Flag any risk that was discussed in detail but NOT quantified (often the most important ones)
- Provide 3-5 key takeaways summarizing the risk landscape and management's preparedness`},S=`You are a senior financial analyst comparing two consecutive quarterly earnings call transcripts.

You are given the key takeaways and quotes from a specific analysis domain for TWO consecutive quarters (Q_t-1 and Q_t).

Your task is to:
1. Identify EVERY meaningful semantic shift between the two quarters
2. For each shift, provide the EXACT VERBATIM quotes from each quarter
3. Describe HOW the narrative changed (more optimistic, more cautious, new disclosure, dropped topic, etc.)
4. Classify each shift as:
   - **Positive**: Structural improvement, risk reduction, upgraded guidance
   - **Negative**: Structural deterioration, new risk, downgraded guidance
   - **Noise**: Cosmetic wording change, compliance boilerplate, no material impact
5. Assign a **signal_score** (float, -10 to +10):
   - Positive signals: +1 to +10 (higher = stronger improvement)
   - Negative signals: -1 to -10 (lower = worse deterioration)
   - Noise signals: -0.5 to +0.5
6. Assign a UI component type:
   - **metric_card**: For quantifiable changes (margins, FCF, ARPU)
   - **status_warning**: For negative signals that need user attention
   - **quote_expander**: For nuanced narrative shifts worth reading in detail

RULES:
- Use VERBATIM quotes. Do NOT paraphrase.
- If Q_t-1 didn't discuss a topic but Q_t does, use "Not discussed in previous quarter" as quote_old
- If Q_t drops a topic discussed in Q_t-1, use "No longer discussed" as quote_new
- Provide 3-5 key takeaways summarizing the overall quarter-over-quarter shift
- The section_name MUST match the domain exactly`,C=`You are a senior sell-side analyst writing the "What Changed This Quarter" block of an earnings flash note.

You are given key delta signals from multiple analysis domains comparing the previous quarter to the current quarter.

Write 8-10 tight bullets capturing the most important directional changes in management language, strategy, and financial posture.

FORMAT: Each bullet = "Topic: From [prior stance] → [new stance]"
Examples:
- CapEx tone: From "elevated rollout phase" → "moderation into FY26"
- Capital allocation: From growth-heavy → deleveraging + dividend intent

RULES:
- Focus on DIRECTION changes, not just facts
- Only include bullets where something materially changed
- Avoid repeating the same signal in different words
- Each bullet must be under 20 words
- If fewer than 8 meaningful changes exist, include fewer — quality over quantity
- Do NOT fabricate shifts; if a domain shows no change, skip it`,E=`You are a fund manager writing the "What This Means Financially" section of an internal earnings brief.

You are given the key delta signals from multiple analysis domains comparing the previous quarter to the current quarter.

Write 5-6 tight bullets connecting the narrative shifts to cash flow and equity value implications.

FORMAT: Each bullet = "[Narrative shift] → [Financial implication]"
Examples:
- Lower capex guidance → expanding FCF conversion in coming quarters
- Accelerated deleveraging → equity value accretion as interest burden falls

RULES:
- Connect one narrative shift to one specific financial outcome per bullet
- Do NOT quantify unless the transcript provides specific numbers
- Focus on: FCF conversion, leverage trajectory, earnings quality, valuation framing, margin structure
- If a signal's financial impact is genuinely unclear, omit it
- Each bullet must be under 25 words
- Do NOT include bullets that are obvious or tautological`,R=`You are analyzing executive Q&A behavior in an earnings call.

Score the executives' evasiveness from 0 to 10:
- 0-2: Very direct, clear answers with specifics
- 3-4: Generally responsive with occasional hedging
- 5-6: Moderate deflection, uses generic language
- 7-8: Frequently avoids direct answers, pivots to talking points
- 9-10: Actively dodges questions, non-answers, contradicts data

Focus on the Q&A section. Look for: redirecting questions, excessive caveats,
answering a different question than asked, vague forward-looking statements.`;async function b(e,t,a,n){let s=N[e];if(!s)return null;let i=`Analyze this earnings call transcript for ${e} insights.

Company: ${a}
Quarter: ${n}

TRANSCRIPT:
${t}`;try{let t=await A(s,i,l);return t.section_name=e,t}catch(t){return console.error(`[${e}] Agent failed:`,t),null}}async function v(e,t,a){let n=`Rate the executive evasiveness in this ${t} ${a} earnings call:

${e.slice(-3e4)}`;try{let e=await A(R,n,m);return Math.max(0,Math.min(10,e.score))}catch{return 5}}async function w(e,t,a,n,s){let i=t.key_takeaways.map(e=>`- ${e}`).join("\n"),r=a.key_takeaways.map(e=>`- ${e}`).join("\n"),o=t.raw_quotes.slice(0,10).map(e=>`"${e}"`).join("\n"),c=a.raw_quotes.slice(0,10).map(e=>`"${e}"`).join("\n"),l=`Compare these two quarters for the **${e}** domain.

PREVIOUS QUARTER (${n}):
Key Takeaways:
${i||"No takeaways extracted"}

Key Quotes:
${o||"No quotes extracted"}

CURRENT QUARTER (${s}):
Key Takeaways:
${r||"No takeaways extracted"}

Key Quotes:
${c||"No quotes extracted"}

Identify all semantic shifts, classify signals, and assign UI components.`;try{let t=await A(S,l,u);return t.section_name=e,t.metrics=t.metrics.map(e=>({...e,validation_status:"verified",validation_note:"",market_validation:"unclear",market_note:""})),t}catch(t){return console.error(`[Temporal Delta] ${e} failed:`,t),null}}function O(e,t,a){return e.map(e=>{let n=e.key_takeaways.map(e=>`  - ${e}`).join("\n"),s=e.metrics.filter(e=>"Noise"!==e.signal_classification).slice(0,4).map(e=>`  [${e.signal_classification}] ${e.subtopic}: ${e.language_shift}`).join("\n");return`=== ${e.section_name} ===
Key takeaways (${t} → ${a}):
${n||"  None"}
Top signals:
${s||"  None"}`}).join("\n\n")}async function L(e,t,a,n){let s=O(e,a,n),i=`Company: ${t}
Comparing: ${a} → ${n}

${s}`;try{return(await A(C,i,p)).bullets??[]}catch(e){return console.error("[EarningsDelta] Agent failed:",e),[]}}async function _(e,t,a,n){let s=O(e,a,n),i=`Company: ${t}
Comparing: ${a} → ${n}

${s}`;try{return(await A(E,i,p)).bullets??[]}catch(e){return console.error("[FCFImplications] Agent failed:",e),[]}}async function M(e,t,a){let n=`Extract key financial metrics from this ${t} ${a} earnings call transcript.

${e.slice(0,4e4)}`;try{let e=await A(I,n,g);return Object.fromEntries(Object.entries(e).filter(([,e])=>"string"==typeof e&&""!==e.trim()))}catch{return{}}}async function P(e,t){let a=r.fk[e]??o.AI[e];if(!a)return 0;let n=function(e){let t=e.match(/^Q(\d)_(\d{4})$/);if(!t)return null;let a=parseInt(t[1]),n=parseInt(t[2]);switch(a){case 1:return{start:new Date(`${n-1}-04-01`),end:new Date(`${n-1}-06-30`)};case 2:return{start:new Date(`${n-1}-07-01`),end:new Date(`${n-1}-09-30`)};case 3:return{start:new Date(`${n-1}-10-01`),end:new Date(`${n-1}-12-31`)};case 4:return{start:new Date(`${n}-01-01`),end:new Date(`${n}-03-31`)};default:return null}}(t);if(!n)return 0;let s=Math.floor(n.start.getTime()/1e3),i=Math.floor(n.end.getTime()/1e3),c=a.nse;try{let e=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${c}?interval=1d&period1=${s}&period2=${i}`,{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(8e3)});if(!e.ok)return 0;let t=await e.json(),a=(t?.chart?.result?.[0]?.indicators?.quote?.[0]?.close??[]).filter(e=>null!==e);if(a.length<2)return 0;let n=(a[a.length-1]-a[0])/a[0]*100;return Math.round(100*n)/100}catch{return 0}}async function k(e,t,a){let n=f(e),s=f(t);if(!n||!s)throw Error("PDF filenames must match format: CompanyTicker_Q#_Year.pdf");if(n.company!==s.company)throw Error(`Company mismatch: ${n.company} vs ${s.company}`);let i=s.company,r=n.quarter,o=s.quarter,[c,l]=await Promise.all([T(e),T(t)]),d=Object.keys(N);a?.({type:"start",sections:d});let[u,m,p]=await Promise.all([Promise.all(d.map(e=>b(e,c,i,r).then(t=>(a?.({type:"thematic_done",section:e,which:"prev"}),t)))),Promise.all(d.map(e=>b(e,l,i,o).then(t=>(a?.({type:"thematic_done",section:e,which:"curr"}),t)))),v(l,i,o).then(e=>(a?.({type:"evasiveness_done",score:e}),e))]),g=u.filter(e=>null!==e),I=m.filter(e=>null!==e);console.log(`[Pipeline] Thematic agents done: prev=${g.length}/4 curr=${I.length}/4`);let A=new Map(g.map(e=>[e.section_name,e])),y=(await Promise.all(I.filter(e=>A.has(e.section_name)).map(e=>w(e.section_name,A.get(e.section_name),e,r,o).then(t=>(a?.({type:"delta_done",section:e.section_name}),t))))).filter(e=>null!==e);console.log(`[Pipeline] Delta agents done: ${y.length}/4 insights produced`);let{insights:h,validationScore:S,flaggedCount:C}=function(e){let t=0,a=0;for(let n of e)for(let e of n.metrics)t++,"Positive"===e.signal_classification&&e.signal_score<0?(e.validation_status="flagged",e.validation_note=`Signal is Positive but score is ${e.signal_score}`,a++):"Negative"===e.signal_classification&&e.signal_score>0&&(e.validation_status="flagged",e.validation_note=`Signal is Negative but score is ${e.signal_score}`,a++);return{insights:e,validationScore:Math.round(10*(t>0?(t-a)/t*100:100))/10,flaggedCount:a}}(y),[E,R,O,k]=await Promise.all([P(i,o).then(e=>(a?.({type:"stock_done",stockPriceChange:e}),e)),L(h,i,r,o),_(h,i,r,o),M(l,i,o)]);console.log(`[Pipeline] Synthesis done: earningsDelta=${R.length} bullets, fcfImplications=${O.length} bullets`);let{insights:B,marketAlignmentPct:D}=function(e,t){let a=0,n=0,s=t>2,i=t<-2;for(let r of e)for(let e of r.metrics){if("Noise"===e.signal_classification)continue;n++;let r="Positive"===e.signal_classification,o="Negative"===e.signal_classification;s&&r||i&&o?(e.market_validation="aligned",e.market_note=`Stock ${s?"gained":"fell"} ${Math.abs(t).toFixed(1)}% — consistent with ${e.signal_classification.toLowerCase()} signal`,a++):(i&&r||s&&o)&&(e.market_validation="divergent",e.market_note=`Stock ${s?"gained":"fell"} ${Math.abs(t).toFixed(1)}% — diverges from ${e.signal_classification.toLowerCase()} signal`)}return{insights:e,marketAlignmentPct:n>0?Math.round(a/n*1e3)/10:0}}(h,E),{score:$,signal:F}=function(e){let t;let a=e.flatMap(e=>e.metrics.map(e=>e.signal_score));if(0===a.length)return{score:0,signal:"Noise"};let n=Math.max(-10,Math.min(10,Math.round(a.reduce((e,t)=>e+t,0)/a.length*100)/100));return t=n>2?"Positive":n<-2?"Negative":Math.abs(n)>.5?"Mixed":"Noise",{score:n,signal:t}}(B),q=B.flatMap(e=>e.key_takeaways.slice(0,2)).slice(0,3).join(" ")||`No significant changes detected between ${r} and ${o} for ${i}.`;return{company_ticker:i,quarter:o,quarter_previous:r,executive_evasiveness_score:Math.round(10*p)/10,insights:B,overall_score:$,overall_signal:F,summary:q,validation_score:S,flagged_count:C,market_alignment_pct:D,stock_price_change:E,market_sources:[],earnings_delta:R,fcf_implications:O,key_metrics:k}}}};