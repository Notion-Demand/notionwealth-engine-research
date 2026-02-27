"""
BSE India public announcements API client.

No authentication required. Rate-limited to 1 request/second.
PDF magic-byte validation is applied on every download.
"""
import time
import logging
from dataclasses import dataclass
from datetime import date

import httpx

logger = logging.getLogger(__name__)

# BSE requires these headers or it returns 403/empty results
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bseindia.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

_API_BASE = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
_PDF_BASE = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/"

_TRANSCRIPT_KEYWORDS = frozenset(
    ["transcript", "conference call", "earnings call", "analyst meet", "concall"]
)

_RATE_LIMIT_SECS = 1.0


@dataclass
class Announcement:
    dt_tm: str           # e.g. "2025-10-25T14:30:00"
    headline: str
    attachment_name: str  # e.g. "20251025_Transcript.pdf"
    subcategory: str

    @property
    def pdf_url(self) -> str:
        return f"{_PDF_BASE}{self.attachment_name}"

    def _is_transcript(self) -> bool:
        haystack = (self.headline + " " + self.subcategory).lower()
        return any(kw in haystack for kw in _TRANSCRIPT_KEYWORDS)


class BSEClient:
    """
    Wraps the BSE public announcements API.

    Usage (context manager):
        with BSEClient() as client:
            anns = client.fetch_announcements(532454, date(2025, 1, 1), date(2026, 2, 27))
            transcripts = client.filter_transcripts(anns)
            pdf_bytes = client.download_pdf(transcripts[0])
    """

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._last_request: float = 0.0

    def __enter__(self) -> "BSEClient":
        self._client = httpx.Client(headers=_HEADERS, timeout=30, follow_redirects=True)
        return self

    def __exit__(self, *_) -> None:
        if self._client:
            self._client.close()
            self._client = None

    def _wait(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < _RATE_LIMIT_SECS:
            time.sleep(_RATE_LIMIT_SECS - elapsed)
        self._last_request = time.monotonic()

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            raise RuntimeError("BSEClient must be used as a context manager")
        return self._client

    def fetch_announcements(
        self,
        bse_scrip_code: int,
        from_date: date,
        to_date: date,
    ) -> list[Announcement]:
        """
        Fetch all company announcements from BSE for a date range.
        Returns announcements newest-first (BSE's natural order).
        """
        self._wait()
        params = {
            "strCat": "-1",
            "strPrevDate": from_date.strftime("%Y%m%d"),
            "strScrip": str(bse_scrip_code),
            "strSearch": "P",
            "strToDate": to_date.strftime("%Y%m%d"),
            "strType": "C",
            "subcategory": "-1",
        }
        client = self._get_client()
        try:
            resp = client.get(_API_BASE, params=params)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("BSE API error for scrip %s: %s", bse_scrip_code, exc)
            raise

        data = resp.json()
        rows = data.get("Table", [])

        announcements = []
        for row in rows:
            att = (row.get("ATTACHMENTNAME") or "").strip()
            if not att:
                continue
            announcements.append(
                Announcement(
                    dt_tm=row.get("DT_TM", ""),
                    headline=row.get("HEADLINE", ""),
                    attachment_name=att,
                    subcategory=row.get("SUBCATNAME", ""),
                )
            )

        logger.debug(
            "Fetched %d announcements for scrip %s (%s → %s)",
            len(announcements), bse_scrip_code,
            from_date.isoformat(), to_date.isoformat(),
        )
        return announcements

    def filter_transcripts(self, announcements: list[Announcement]) -> list[Announcement]:
        """
        Return only transcript announcements, newest-first.
        Filters on headline or subcategory containing a trigger keyword.
        """
        transcripts = [a for a in announcements if a._is_transcript()]
        logger.debug("Filtered %d transcripts from %d announcements", len(transcripts), len(announcements))
        return transcripts

    def download_pdf(self, announcement: Announcement) -> bytes:
        """
        Download the PDF attachment.  Validates %PDF magic bytes.
        Raises ValueError if the response is not a valid PDF.
        """
        self._wait()
        client = self._get_client()
        url = announcement.pdf_url
        try:
            resp = client.get(url)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("Failed to download PDF %s: %s", url, exc)
            raise

        data = resp.content
        if not data.startswith(b"%PDF"):
            raise ValueError(
                f"Downloaded file is not a valid PDF (magic bytes: {data[:8]!r}): {url}"
            )

        logger.debug("Downloaded %d bytes from %s", len(data), url)
        return data
