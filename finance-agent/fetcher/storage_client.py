"""
Supabase Storage client for the transcript fetcher.

Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment.
Uses the supabase-py SDK which handles both JWT and sb_secret_ key formats.
"""
import os
import logging

from supabase import create_client, Client

logger = logging.getLogger(__name__)

BUCKET = "transcripts"
_client: Client | None = None


def _get_client() -> Client:
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL", "").strip('"')
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip('"')
        if not url:
            raise RuntimeError("SUPABASE_URL environment variable is not set")
        if not key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY environment variable is not set")
        _client = create_client(url, key)
    return _client


def list_files(prefix: str = "") -> set[str]:
    """Return the set of filenames currently in the transcripts bucket."""
    result = _get_client().storage.from_(BUCKET).list(prefix, {"limit": 1000, "offset": 0, "sortBy": {"column": "name", "order": "asc"}})
    return {item["name"] for item in result}


def upload(filename: str, content: bytes) -> None:
    """Upload (upsert) a PDF to the transcripts bucket."""
    _get_client().storage.from_(BUCKET).upload(
        filename,
        content,
        {"content-type": "application/pdf", "upsert": "true"},
    )
    logger.debug("Uploaded %s (%d bytes)", filename, len(content))
