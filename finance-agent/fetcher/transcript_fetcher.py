"""
Orchestrator: fetches earnings call transcripts for Nifty 50 companies from BSE.

Quarter inference:
  Stage 1 (primary)  — regex from first 3 PDF pages: Q([1-4])\\s*[-–]?\\s*FY\\s*['\"]?(\\d{2,4})
  Stage 2 (fallback) — derive from announcement date using Indian FY calendar
"""
import io
import logging
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import pdfplumber

from .bse_client import Announcement, BSEClient
from .nifty50 import NIFTY50

logger = logging.getLogger(__name__)

# Resolved relative to this file's location (finance-agent/fetcher/ → finance-agent/)
DEFAULT_OUTPUT_DIR: Path = (
    Path(__file__).parent.parent / "multiagent_analysis" / "all-pdfs"
)

_FY_REGEX = re.compile(
    r"Q([1-4])\s*[-\u2013]?\s*FY\s*['\"]?(\d{2,4})",
    re.IGNORECASE,
)


# ─── Quarter inference helpers ────────────────────────────────────────────────

def _normalise_year(raw: str) -> Optional[int]:
    """Convert 2-digit or 4-digit FY end year string to a 4-digit int."""
    y = int(raw)
    if y < 100:
        # Treat as 20xx; FY26 → 2026, FY99 → 2099 (unlikely but safe)
        y += 2000
    if not (2020 <= y <= 2035):
        return None
    return y


def _infer_quarter_from_text(pdf_bytes: bytes) -> Optional[tuple[int, int]]:
    """
    Read first 3 pages of a PDF and look for 'Q{n} FY{yy/yyyy}' pattern.
    Returns (quarter_number, fy_end_year) or None.
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            text = ""
            for page in pdf.pages[:3]:
                text += (page.extract_text() or "") + "\n"
    except Exception as exc:
        logger.warning("pdfplumber failed while reading PDF bytes: %s", exc)
        return None

    for m in _FY_REGEX.finditer(text):
        q = int(m.group(1))
        year = _normalise_year(m.group(2))
        if year is not None:
            logger.debug("Inferred Q%d FY%d from PDF text", q, year)
            return q, year

    return None


def _infer_quarter_from_date(ann_date: date) -> tuple[int, int]:
    """
    Fallback: derive (quarter_number, fy_end_year) from announcement date.

    Indian FY = Apr–Mar; the FY end year is the year March falls in.

    Month → Quarter:
      Apr–Jul  → Q4 of the *same* FY (FY end = same calendar year)
      Aug–Oct  → Q1 of the *next* FY
      Nov–Dec  → Q2 of the *next* FY
      Jan      → Q2 of the *current* FY  (FY end = same calendar year)
      Feb–Mar  → Q3 of the *current* FY
    """
    m = ann_date.month
    y = ann_date.year
    if 4 <= m <= 7:
        return 4, y
    elif 8 <= m <= 10:
        return 1, y + 1
    elif 11 <= m <= 12:
        return 2, y + 1
    elif m == 1:
        return 2, y
    else:  # Feb–Mar
        return 3, y


def _parse_ann_date(dt_tm: str) -> Optional[date]:
    """Parse BSE 'DT_TM' field (ISO-ish string) to a date."""
    if not dt_tm:
        return None
    # Accept formats: "2025-10-25T14:30:00", "2025-10-25 14:30:00", "2025-10-25"
    try:
        return date.fromisoformat(dt_tm[:10])
    except ValueError:
        logger.warning("Cannot parse announcement date: %r", dt_tm)
        return None


# ─── Core fetch logic ─────────────────────────────────────────────────────────

def _quarter_label(q: int, year: int) -> str:
    return f"Q{q}_{year}"


def _output_path(ticker: str, q: int, year: int, output_dir: Path) -> Path:
    return output_dir / f"{ticker}_{_quarter_label(q, year)}.pdf"


def fetch_ticker(
    ticker: str,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    lookback_days: int = 548,
    dry_run: bool = False,
) -> list[Path]:
    """
    Fetch all available transcript PDFs for a Nifty 50 ticker.

    Args:
        ticker:       Registry key (e.g. "BHARTI").
        output_dir:   Directory to write PDFs into.
        lookback_days: How far back to search (default ~18 months).
        dry_run:      If True, discover but do not write any files.

    Returns:
        List of Paths that were newly written (empty on dry_run or all-skipped).
    """
    ticker = ticker.upper()
    if ticker not in NIFTY50:
        raise ValueError(f"Unknown ticker '{ticker}'. Run --list to see all 50.")

    info = NIFTY50[ticker]
    bse_code = info["bse"]
    to_date = date.today()
    from_date = to_date - timedelta(days=lookback_days)

    logger.info(
        "[%s] Querying BSE (scrip=%d) %s → %s...",
        ticker, bse_code, from_date.isoformat(), to_date.isoformat(),
    )

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    new_files: list[Path] = []

    with BSEClient() as client:
        try:
            announcements = client.fetch_announcements(bse_code, from_date, to_date)
        except Exception as exc:
            logger.error("[%s] BSE API error: %s", ticker, exc)
            raise

        transcripts = client.filter_transcripts(announcements)
        logger.info(
            "[%s] %d announcements, %d transcripts found",
            ticker, len(announcements), len(transcripts),
        )

        for ann in transcripts:
            ann_date = _parse_ann_date(ann.dt_tm)

            # ── Fast pre-check via date-based inference ───────────────────────
            # Avoids a network round-trip when the file already exists or
            # when we're in dry-run mode (no writes needed at all).
            date_quarter = _infer_quarter_from_date(ann_date) if ann_date else None

            if date_quarter is not None:
                q_fast, year_fast = date_quarter
                dest_fast = _output_path(ticker, q_fast, year_fast, output_dir)
                if dest_fast.exists():
                    logger.info("[%s] Skipping %s — already exists", ticker, dest_fast.name)
                    continue

                if dry_run:
                    logger.info(
                        "[%s] DRY RUN — would save %s (inferred from announcement date)",
                        ticker, dest_fast.name,
                    )
                    continue

            elif dry_run:
                logger.info(
                    "[%s] DRY RUN — %s: no date available, cannot infer quarter",
                    ticker, ann.attachment_name,
                )
                continue

            # ── Download PDF ──────────────────────────────────────────────────
            logger.info("[%s] Downloading %s...", ticker, ann.attachment_name)
            try:
                pdf_bytes = client.download_pdf(ann)
            except Exception as exc:
                logger.warning("[%s] Skipping %s: download failed: %s", ticker, ann.attachment_name, exc)
                continue

            # ── Stage 1: infer quarter from PDF text ──────────────────────────
            quarter_info = _infer_quarter_from_text(pdf_bytes)
            infer_source = "PDF text"

            # ── Stage 2: fallback to announcement date ────────────────────────
            if quarter_info is None:
                if ann_date:
                    quarter_info = _infer_quarter_from_date(ann_date)
                    infer_source = "announcement date"
                else:
                    logger.warning(
                        "[%s] Cannot infer quarter for %s — no date and no PDF match; skipping",
                        ticker, ann.attachment_name,
                    )
                    continue

            q, year = quarter_info
            dest = _output_path(ticker, q, year, output_dir)

            if dest.exists():
                logger.info("[%s] Skipping %s — already exists", ticker, dest.name)
                continue

            dest.write_bytes(pdf_bytes)
            size_kb = len(pdf_bytes) // 1024
            logger.info(
                "[%s] ✓ Saved: %s (%d KB, inferred from %s)",
                ticker, dest.name, size_kb, infer_source,
            )
            new_files.append(dest)

    return new_files


def fetch_all(
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    lookback_days: int = 548,
    dry_run: bool = False,
) -> dict[str, list[Path]]:
    """
    Fetch transcripts for all 50 Nifty companies.
    Continues past individual failures; returns per-ticker results.
    """
    results: dict[str, list[Path]] = {}
    for ticker in NIFTY50:
        try:
            paths = fetch_ticker(ticker, output_dir, lookback_days, dry_run)
            results[ticker] = paths
        except Exception as exc:
            logger.error("[%s] Failed: %s", ticker, exc)
            results[ticker] = []
    return results
