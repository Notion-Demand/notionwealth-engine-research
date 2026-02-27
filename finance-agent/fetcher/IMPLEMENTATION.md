# Nifty 50 Transcript Fetcher — Implementation Notes

Automates discovery and download of earnings call transcripts from BSE India's
public announcements API. Replaces manual PDF placement in `all-pdfs/`.

## Files

### `nifty50.py`
Single source of truth for the 50-company registry.

```python
NIFTY50: dict[str, dict]  # ticker → {bse, nse, name}
```

**Key naming rules (filename regex safety):**
- All ticker keys are alpha-only → satisfy `^([A-Za-z]+)_Q(\d)_(\d{4})\.pdf$`
- `MM` instead of `M&M`; `BAJAJAUTO` instead of `BAJAJ-AUTO`
- Original 10 keys preserved verbatim for backward-compat with existing PDFs:
  `BHARTI`, `SBI`, `HDFC`, `BAJAJ`, `ICICI`, `INFOSYS`, `LT`, `HUL`, `TCS`, `RELIANCE`

Four BSE scrip codes marked ⚠ in source should be verified against bseindia.com:
`SBILIFE (540719)`, `HDFCLIFE (540777)`, `ICICIPRULI (540133)`, `LTIM (540005)`

---

### `bse_client.py`
Thin HTTP wrapper around BSE's public announcements endpoint.

**API:**
```
GET https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w
    ?strCat=-1&strPrevDate=YYYYMMDD&strScrip={BSE_CODE}
    &strSearch=P&strToDate=YYYYMMDD&strType=C&subcategory=-1
```

**PDF download:**
```
https://www.bseindia.com/xml-data/corpfiling/AttachHis/{ATTACHMENTNAME}
```

**`Announcement` dataclass** — fields: `dt_tm`, `headline`, `attachment_name`, `subcategory`; `.pdf_url` property.

**`BSEClient`** — context manager; enforces 1 s rate-limit between requests.
Required headers: `User-Agent: Mozilla/5.0`, `Referer: https://www.bseindia.com/`.
`download_pdf()` validates `%PDF` magic bytes before returning.

Transcript filter keywords (headline or subcategory, case-insensitive):
`transcript`, `conference call`, `earnings call`, `analyst meet`, `concall`

---

### `transcript_fetcher.py`
Orchestrator. Key function: `fetch_ticker(ticker, output_dir, lookback_days, dry_run)`.

**Quarter inference — two stages:**

| Stage | Method | Source |
|-------|--------|--------|
| 1 (primary) | Regex on first 3 PDF pages | `Q([1-4])\s*[-–]?\s*FY\s*['\"]?(\d{2,4})` |
| 2 (fallback) | Announcement date + Indian FY calendar | |

Indian FY date → quarter mapping:

| Month | Quarter | FY end year |
|-------|---------|-------------|
| Apr–Jul | Q4 | same year |
| Aug–Oct | Q1 | year + 1 |
| Nov–Dec | Q2 | year + 1 |
| Jan | Q2 | same year |
| Feb–Mar | Q3 | same year |

**Performance optimisation:** date-based pre-check runs before any download.
If the expected file already exists, the download is skipped entirely.
In `--dry-run` mode, no PDFs are downloaded at all.

**`fetch_all()`** — iterates all 50 tickers, continues past individual failures.

Default output: `finance-agent/multiagent_analysis/all-pdfs/`

---

### `cli.py`

```
python -m fetcher.cli --ticker BHARTI           # single ticker
python -m fetcher.cli --ticker RELIANCE --lookback 365
python -m fetcher.cli --all                     # all 50 (~2 min with 1 s delay)
python -m fetcher.cli --all --dry-run           # discover without writing
python -m fetcher.cli --list                    # print registry table
python -m fetcher.cli --all --verbose           # DEBUG logging
```

Exit codes: `0` = success, `1` = all tickers failed (or unknown ticker).

---

## `multiagent_analysis/parser.py` changes

- `NSE_TICKERS`: expanded from 10 → 50 entries. Original 10 keys unchanged.
- `TICKER_ALIASES`: expanded from ~20 → 153 entries covering all 50 companies.
  Notable corrections: `"bajaj finserv"` now maps to `BAJAJFINSV` (separate
  company from Bajaj Finance `BAJAJ`).

---

## Dependencies

No new dependencies. Uses packages already in `requirements.txt`:
- `httpx>=0.27.0` — HTTP client
- `pdfplumber` — PDF text extraction for quarter inference

## Running

```bash
cd finance-agent

# Verify registry
python -m fetcher.cli --list

# Dry-run (no disk writes, no PDF downloads)
python -m fetcher.cli --ticker BHARTI --dry-run

# Fetch one company
python -m fetcher.cli --ticker BHARTI

# Fetch all Nifty 50
python -m fetcher.cli --all
```
