"""
POST /analyze — Run the multi-agent disclosure analysis pipeline.

Request body (structured — preferred):
  { "ticker": "BHARTI", "q_prev": "Q2_2026", "q_curr": "Q3_2026" }

The endpoint resolves the PDF paths from the all-pdfs directory,
runs the full multi-agent pipeline, persists the result, and returns
the DashboardPayload.
"""

import json
import os
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.auth import get_current_user
from db.supabase import supabase_admin

router = APIRouter(prefix="/analyze", tags=["analyze"])

_PDF_DIR = Path(__file__).parent.parent / "multiagent_analysis" / "all-pdfs"


# ── Request / Response models ─────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    # Structured (preferred)
    ticker: Optional[str] = None
    q_prev: Optional[str] = None
    q_curr: Optional[str] = None


class AnalyzeResponse(BaseModel):
    id: str
    payload: dict


# ── PDF resolver ──────────────────────────────────────────────────────────────

def _resolve_pdf(ticker: str, quarter: str) -> Path:
    """
    Find PDF for ticker+quarter in all-pdfs/, case-insensitive.
    Raises HTTPException 422 if not found.
    """
    target = f"{ticker}_{quarter}.pdf".lower()
    for fname in os.listdir(_PDF_DIR):
        if fname.lower() == target:
            return _PDF_DIR / fname

    available = sorted(
        f for f in os.listdir(_PDF_DIR)
        if f.upper().startswith(ticker.upper() + "_")
    )
    hint = f" Available for {ticker}: {available}" if available else ""
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"PDF not found: {ticker} {quarter}.{hint}",
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("", response_model=AnalyzeResponse)
async def analyze(
    req: AnalyzeRequest,
    user_id: Annotated[str, Depends(get_current_user)],
):
    """Run the multi-agent disclosure analysis pipeline."""
    if not req.ticker or not req.q_prev or not req.q_curr:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Required fields: ticker, q_prev, q_curr",
        )

    if req.q_prev == req.q_curr:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="q_prev and q_curr must be different quarters",
        )

    ticker = req.ticker.upper()
    q_prev_path = _resolve_pdf(ticker, req.q_prev)
    q_curr_path = _resolve_pdf(ticker, req.q_curr)

    try:
        from multiagent_analysis.pipeline import run_pipeline
        payload = await run_pipeline(str(q_prev_path), str(q_curr_path))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline error: {exc}",
        ) from exc

    # Persist to DB
    row = {
        "user_id": user_id,
        "company_ticker": ticker,
        "q_prev": req.q_prev,
        "q_curr": req.q_curr,
        "payload": json.dumps(payload),
    }
    result = supabase_admin.table("analysis_results").insert(row).execute()
    record_id: str = result.data[0]["id"] if result.data else "unknown"

    return AnalyzeResponse(id=record_id, payload=payload)


@router.get("/history", response_model=list[dict])
async def get_history(user_id: Annotated[str, Depends(get_current_user)]):
    """Fetch the 20 most recent analysis results for this user."""
    result = (
        supabase_admin.table("analysis_results")
        .select("id, company_ticker, q_curr, payload, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    return result.data or []
