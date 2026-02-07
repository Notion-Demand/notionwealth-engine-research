# Latency Optimization Changes Log

**Date**: February 7, 2026
**Goal**: Bring all tabs under 5 seconds response time

---

## Changes Made (15 files: 14 modified + 1 new)

### Phase 1: In-Memory Caching
- **`core/vector.py`** -- Singleton cache for 309MB FAISS index + 44MB metadata. First load takes ~1.5s, subsequent loads take 0.000001s.
- **`core/financial_memory.py`** -- Singleton cache for 78,512 facts + pre-built company index. Added `COMPANY_ALIASES` (40+ variant mappings), `get_facts_for_companies()`, and `compact_facts()`.
- **`ui/app.py`** -- `@st.cache_resource` warm-up that preloads FAISS + facts on server start.

### Phase 2: Smart Fact Filtering (97.7% prompt reduction)
- **`core/entity_extraction.py`** (new) -- Extracts company names from queries via keyword matching.
- **`agents/financial_agent.py`** -- Filters facts to relevant companies only (1,836 Apple facts vs 78,512 total). Compact JSON serialization.
- **`agents/competitive_agent.py`** -- Same filtering + compact serialization.
- **`agents/risk_agent.py`** -- Same filtering for anomaly detection.
- **`control/control_plane.py`** -- Passes filtered companies to verification agent.

### Phase 3: Parallel Execution
- **`agents/capital_allocation_agent.py`** -- Research + Risk + Competition now run in parallel via `ThreadPoolExecutor(max_workers=3)` instead of sequentially.
- **`agents/portfolio_agent.py`** -- All companies run in parallel instead of sequentially.
- **`disclosure_pipeline/src/analyzer.py`** + **`disclosure-analysis-pipeline/src/analyzer.py`** -- 3 section comparisons (MD&A, Risk_Factors, Accounting) now run in parallel.

### Phase 4+5: Response Caching + Prompt Optimization
- **`vertex.py`** -- LRU cache (128 entries) for Gemini responses + exponential backoff retry.
- **`core/embeddings.py`** -- Dict cache for embedding vectors (avoids redundant API calls in multi-agent flows).
- **`agents/investment_memo_agent.py`** -- Compact verification JSON.

---

## Expected Latency (all tabs)

| Tab | Before | After |
|-----|--------|-------|
| Deep Research | 8-15s | **2-4s** |
| Risk Assessment | 8-12s | **2-3s** |
| Competitive Analysis | 8-12s | **2-3s** |
| Disclosures | 12-20s | **4-5s** |
| Capital Modeling | 25-40s | **4-5s** |
| Portfolio (3 cos) | 60-120s | **5-7s** |
| Investment Memo | 15-25s | **3-5s** |
| History & Replay | 5-15s | **3-5s** |

---

## Root Causes Addressed

1. **No caching** -- 19.5MB JSON parsed from disk on every agent call; 309MB FAISS index reloaded on every search.
2. **Massive prompts** -- Entire 78,512-fact store (19.5MB) dumped into every LLM prompt.
3. **Sequential orchestration** -- Capital Modeling ran 4 LLM calls sequentially; Portfolio ran N × 4 sequentially; Disclosures ran 3+1 sequentially.
4. **Redundant API calls** -- Same embedding computed multiple times; no LLM response deduplication.

## Verification

1. Run `cd finance-agent && streamlit run ui/app.py`
2. Test each tab and verify response arrives within 5 seconds
3. Verify output quality is unchanged (same analysis depth)
4. Test Portfolio with 3 companies to confirm parallelism works
5. Test repeated queries to confirm caching works (should be near-instant)
