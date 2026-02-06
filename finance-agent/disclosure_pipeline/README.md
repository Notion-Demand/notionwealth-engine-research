# Financial Disclosure Analysis Pipeline

An intelligent Python pipeline that uses AI to extract, compare, and analyze disclosure changes from earnings call transcripts using Google Gemini.

## Overview

This pipeline automates the detection of meaningful changes in financial disclosures by:
- **Extracting** content from earnings call transcript PDFs
- **Categorizing** discussions into MD&A, Risk Factors, and Accounting using AI
- **Comparing** consecutive quarters to detect changes
- **Classifying** signals as Positive, Negative, or Noise

## Features

- **AI-Powered Semantic Extraction**: Intelligently identifies relevant content from unstructured dialogue
- **Dual Mode Support**: Works with earnings call transcripts (default) AND structured SEC filings (regex mode)
- **PDF Parsing**: Robust text extraction using pdfplumber
- **Change Detection**: Google Gemini analyzes quarter-over-quarter differences
- **Signal Classification**: Automatic positive/negative/noise labeling
- **Batch Processing**: Process multiple companies and quarters efficiently
- **CSV Export**: Ready-to-analyze output with full change log

## Quick Start

### 1. Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure API Key

Create a `.env` file in the project root:

```bash
GOOGLE_API_KEY=your_google_api_key_here
```

Get your API key from: https://aistudio.google.com/app/apikey

### 3. Prepare PDF Files

Place earnings call transcript PDFs in the `data/` folder using this naming convention:

```
CompanyTicker_Q#_Year.pdf
```

**Examples:**
- `AAPL_Q1_2024.pdf`
- `AAPL_Q2_2024.pdf`
- `MSFT_Q1_2024.pdf`

### 4. Run Pipeline

```bash
# Full pipeline: Extract from PDFs → AI categorization → Compare quarters
python3 -m src.pipeline

# Use existing parsed data (skip PDF processing)
python3 -m src.pipeline --skip-parsing

# Test without making API calls
python3 -m src.pipeline --dry-run
```

## Project Structure

```
disclosure-analysis-pipeline/
├── data/                          # Place your PDF files here
├── output/                        # Generated outputs
│   ├── parsed_data.json          # Extracted & categorized content
│   ├── disclosure_changes.csv    # Detected changes (main output)
│   └── summary.json              # Analysis statistics
├── src/
│   ├── pipeline.py               # Main orchestrator
│   ├── parser.py                 # PDF text extraction
│   ├── semantic_extraction.py    # AI-based content categorization
│   ├── analyzer.py               # Quarter-to-quarter comparison
│   └── models.py                 # Data structure definitions
├── create_sample_data.py         # Generate test data
├── requirements.txt
└── .env                          # API credentials
```

## How It Works

### Phase 1: PDF Parsing & Semantic Extraction

**For Earnings Call Transcripts (Default Mode):**

1. **Text Extraction** (`parser.py`):
   - Extracts full text from PDFs using pdfplumber
   - Handles 15-20 page transcripts (up to 80,000 characters)

2. **AI Categorization** (`semantic_extraction.py`):
   - Sends transcript to Gemini AI
   - AI reads the dialogue and identifies:
     - **MD&A Content**: Business performance, revenue, strategy discussions
     - **Risk Factors**: Risks, challenges, uncertainties mentioned
     - **Accounting**: Policy changes, estimates, methodology updates
   - Saves structured JSON: `{company: {quarter: {section: text}}}`

**For SEC Filings (Optional `--use-regex` mode):**
- Uses regex patterns to find sections by Item numbers
- Falls back to fuzzy keyword search if patterns fail

### Phase 2: AI-Powered Comparison

**Change Detection** (`analyzer.py`):

1. Loads consecutive quarters for each company (Q1→Q2, Q2→Q3, etc.)
2. For each section, compares previous vs current quarter using Gemini
3. AI detects:
   - **Language shifts**: "strong growth" → "moderated growth" (Negative)
   - **New specificity**: "temporary challenges" → "structural supply chain issues" (More specific)
   - **Accounting changes**: Depreciation 4 years → 5 years (Policy change)
4. Returns 0-5 most meaningful changes per section

### Phase 3: Output Generation

Produces:
- **CSV file** with all detected changes
- **Summary statistics** by signal type and section
- **Audit logs** for transparency

## Output Format

### `disclosure_changes.csv`

| Company | Quarter_Previous | Quarter_Current | Section | Quote_Old | Quote_New | Description | Signal |
|---------|-----------------|-----------------|---------|-----------|-----------|-------------|---------|
| AAPL | Q1_2024 | Q2_2024 | MD&A | "revenue growth remained robust" | "revenue growth moderated" | Revenue language weakened | Negative |
| AAPL | Q1_2024 | Q2_2024 | Risk_Factors | "temporary supply challenges" | "structural supply constraints" | Risk language intensified | Negative |
| AAPL | Q1_2024 | Q2_2024 | Accounting | "depreciation over 4 years" | "depreciation over 5 years" | Extended useful life | Noise |

### Columns Explained:
- **Company**: Ticker symbol
- **Quarter_Previous**: Previous quarter (e.g., Q1_2024)
- **Quarter_Current**: Current quarter (e.g., Q2_2024)
- **Section**: MD&A, Risk_Factors, or Accounting
- **Quote_Old**: Verbatim excerpt from previous quarter
- **Quote_New**: Verbatim excerpt from current quarter
- **Description**: One-sentence summary of what changed
- **Signal**: Positive, Negative, or Noise

### `parsed_data.json`

Intermediate file with categorized content:

```json
{
  "AAPL": {
    "Q1_2024": {
      "MD&A": "CEO discussed Q1 revenue of $100B...",
      "Risk_Factors": "CEO mentioned supply chain challenges...",
      "Accounting": "CFO announced depreciation policy change..."
    },
    "Q2_2024": { ... }
  }
}
```

## CLI Options

```bash
python3 -m src.pipeline [OPTIONS]

Options:
  --data-dir DIR        Directory with PDF files (default: data)
  --output-dir DIR      Output directory (default: output)
  --dry-run            Skip LLM API calls for testing
  --skip-parsing       Use existing parsed_data.json
  --use-regex          Use regex extraction instead of AI (for SEC filings)
```

## Usage Examples

### Example 1: Analyze Apple Earnings Calls

```bash
# 1. Place transcripts in data/
data/
├── AAPL_Q1_2024.pdf
├── AAPL_Q2_2024.pdf
├── AAPL_Q3_2024.pdf
└── AAPL_Q4_2024.pdf

# 2. Run full pipeline
python3 -m src.pipeline

# 3. Review output/disclosure_changes.csv
```

**Result:** Detects changes across Q1→Q2, Q2→Q3, Q3→Q4

### Example 2: Test with Sample Data

```bash
# Generate fake earnings call data
python3 create_sample_data.py

# Test comparison logic without parsing PDFs
python3 -m src.pipeline --skip-parsing

# Review output to verify pipeline works
```

### Example 3: Multi-Company Analysis

```bash
# Place multiple companies' transcripts
data/
├── AAPL_Q1_2024.pdf
├── AAPL_Q2_2024.pdf
├── MSFT_Q1_2024.pdf
├── MSFT_Q2_2024.pdf
├── GOOGL_Q1_2024.pdf
└── GOOGL_Q2_2024.pdf

# Run pipeline (processes all companies)
python3 -m src.pipeline
```

## Expected Input Format

### For Earnings Call Transcripts (Default)

- **Format**: Dialogue-style transcripts (CEO, CFO, Analysts)
- **Length**: 10-25 pages typical (up to 80,000 characters supported)
- **Content**: Unstructured discussions, no explicit section headers
- **Example**: Seeking Alpha transcripts, company investor relations PDFs

**Sample Content:**
```
CEO: Thank you for joining our Q2 call. Revenue grew 15% to $500M, 
driven by strong cloud demand...

Analyst: Can you discuss the margin compression?

CFO: Gross margin decreased from 45% to 42% due to product mix. 
We also changed our depreciation policy from 4 to 5 years...
```

### For SEC Filings (With `--use-regex`)

- **Format**: Structured 10-Q/10-K filings
- **Sections**: Clearly marked with Item numbers
- **Example**: Official SEC EDGAR filings

## Cost Estimates

With **Google Gemini 2.0 Flash Lite** (free tier):
- 15 requests per minute (free)
- 1,500 requests per day (free)

**For typical analysis:**
- 2 companies × 4 quarters = 8 transcripts
- Semantic extraction: 8 AI calls
- Comparisons: 6 AI calls (Q1→Q2, Q2→Q3, Q3→Q4 for 2 companies)
- **Total: ~14 API calls** (well within free tier!)

**If you exceed quota:**
- Switch to paid tier (~$0.00001 per token)
- 4 quarters analysis: ~$0.50-$1.00

## Troubleshooting

### Issue: "Quota exceeded" error

**Solution:** You've hit the free tier limit. Either:
1. Wait for quota reset (daily/monthly)
2. Upgrade to paid tier
3. Use a different API key from a new Google Cloud project

### Issue: No sections extracted

**Possible causes:**
1. PDF is scanned image (not text-extractable)
2. Transcript format is non-standard
3. API key is invalid

**Solutions:**
- Verify PDF has selectable text
- Check `.env` file has correct `GOOGLE_API_KEY`
- Review `output/parsed_data.json` to see what was extracted

### Issue: Changes not detected

**Why:** AI determined sections are too similar or changes are trivial

**Verify:**
- Check if consecutive quarters exist (need Q1 AND Q2 to compare)
- Review `parsed_data.json` to ensure content was extracted
- Run with `--dry-run` to test without API calls

## Development

### Running Tests

```bash
# Test with sample data (no API calls)
python3 create_sample_data.py
python3 -m src.pipeline --skip-parsing --dry-run
```

### Adding New Companies

Just add PDFs following the naming convention:
```
{TICKER}_Q{#}_{YEAR}.pdf
```

The pipeline automatically detects and processes all files.

### Customizing Prompts

Edit the prompts in:
- `src/semantic_extraction.py` (line 31): Extraction instructions
- `src/analyzer.py` (line 19): Comparison rules

## File Descriptions

| File | Purpose |
|------|---------|
| `src/pipeline.py` | Main orchestrator - coordinates entire workflow |
| `src/parser.py` | PDF text extraction using pdfplumber |
| `src/semantic_extraction.py` | AI categorizes transcript into MD&A/Risk/Accounting |
| `src/analyzer.py` | AI compares quarters and detects changes |
| `src/models.py` | Pydantic data models for type safety |
| `create_sample_data.py` | Generate test data for validation |

## Dependencies

- **Python 3.13+** (tested on 3.13)
- **pdfplumber**: PDF text extraction
- **langchain-google-genai**: Gemini AI integration
- **pandas**: Data manipulation
- **pydantic**: Data validation
- **python-dotenv**: Environment variable management

See `requirements.txt` for full list.

## Limitations

- **Context Window**: Transcripts truncated to 80,000 characters (~20 pages)
- **English Only**: AI prompts optimized for English-language transcripts
- **Consecutive Quarters**: Requires at least 2 quarters to detect changes
- **PDF Format**: Requires text-extractable PDFs (not scanned images)

## Future Enhancements

- Multi-language support
- Integration with earnings call APIs (auto-download)
- Trend analysis across multiple quarters
- Interactive visualization dashboard
- Email alerts for critical changes

## License

MIT License - See LICENSE file for details

## Support

For questions or issues:
1. Check the troubleshooting section
2. Review `PIPELINE_ARCHITECTURE.md` for technical details
3. Check the logs in console output for specific errors

---

**Quick Reference:**

```bash
# Test everything works
python3 create_sample_data.py && python3 -m src.pipeline --skip-parsing

# Analyze real PDFs
python3 -m src.pipeline

# Reanalyze without re-parsing
python3 -m src.pipeline --skip-parsing
```
