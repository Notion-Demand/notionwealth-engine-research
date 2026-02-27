"""
POST /analyze — Run the analysis pipeline and cache the result.

Request body:
  { "query": "Analyze Bharti Airtel earnings Q3 FY25" }

The pipeline call is intentionally thin: it delegates to the existing
`vertex.call_gemini` / agent logic. Results are stored in `analysis_results`
so the frontend can retrieve them later.
"""

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.auth import get_current_user
from db.supabase import supabase_admin

router = APIRouter(prefix="/analyze", tags=["analyze"])


class AnalyzeRequest(BaseModel):
    query: str


class AnalyzeResponse(BaseModel):
    id: str
    payload: dict


@router.post("", response_model=AnalyzeResponse)
async def analyze(
    req: AnalyzeRequest,
    user_id: Annotated[str, Depends(get_current_user)],
):
    """Run analysis pipeline and persist result."""
    try:
        # Lazy import to avoid loading heavy deps at startup
        from vertex import call_gemini  # type: ignore[import]

        raw = call_gemini(req.query)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline error: {exc}",
        ) from exc

    # Wrap plain-text response in a minimal payload envelope
    payload: dict
    if isinstance(raw, dict):
        payload = raw
    else:
        payload = {"result": str(raw), "query": req.query}

    # Persist to DB
    row = {
        "user_id": user_id,
        "company_ticker": _extract_ticker(req.query),
        "q_prev": "",
        "q_curr": "",
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


def _extract_ticker(query: str) -> str:
    """Best-effort ticker/company extraction from free-form query."""
    words = query.upper().split()
    # Return last word as a rough proxy for ticker; improve as needed
    return words[-1] if words else "UNKNOWN"
