"""
/connections — CRUD for stored OAuth tokens.

GET  /connections          → list provider connections for the caller
POST /connections          → upsert a connection (called by OAuth callbacks)
DELETE /connections/{provider} → remove a connection
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.auth import get_current_user
from db.supabase import supabase_admin

router = APIRouter(prefix="/connections", tags=["connections"])


# ── Models ────────────────────────────────────────────────────────────────────

class GmailConnectionIn(BaseModel):
    gmail_email: str
    gmail_access_token: str
    gmail_refresh_token: str
    gmail_token_expiry: str  # ISO-8601 string


class SlackConnectionIn(BaseModel):
    slack_team_id: str
    slack_team_name: str
    slack_bot_token: str


class ConnectionOut(BaseModel):
    provider: str
    connected_at: str
    # Gmail
    gmail_email: str | None = None
    # Slack
    slack_team_id: str | None = None
    slack_team_name: str | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ConnectionOut])
async def list_connections(user_id: Annotated[str, Depends(get_current_user)]):
    result = (
        supabase_admin.table("user_connections")
        .select("provider, connected_at, gmail_email, slack_team_id, slack_team_name")
        .eq("user_id", user_id)
        .execute()
    )
    return result.data or []


@router.post("/gmail", status_code=status.HTTP_200_OK)
async def upsert_gmail(
    payload: GmailConnectionIn,
    user_id: Annotated[str, Depends(get_current_user)],
):
    row = {
        "user_id": user_id,
        "provider": "gmail",
        "gmail_email": payload.gmail_email,
        "gmail_access_token": payload.gmail_access_token,
        "gmail_refresh_token": payload.gmail_refresh_token,
        "gmail_token_expiry": payload.gmail_token_expiry,
    }
    supabase_admin.table("user_connections").upsert(
        row, on_conflict="user_id,provider"
    ).execute()
    return {"status": "ok"}


@router.post("/slack", status_code=status.HTTP_200_OK)
async def upsert_slack(
    payload: SlackConnectionIn,
    user_id: Annotated[str, Depends(get_current_user)],
):
    row = {
        "user_id": user_id,
        "provider": "slack",
        "slack_team_id": payload.slack_team_id,
        "slack_team_name": payload.slack_team_name,
        "slack_bot_token": payload.slack_bot_token,
    }
    supabase_admin.table("user_connections").upsert(
        row, on_conflict="user_id,provider"
    ).execute()
    return {"status": "ok"}


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    provider: str,
    user_id: Annotated[str, Depends(get_current_user)],
):
    if provider not in ("gmail", "slack"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="provider must be 'gmail' or 'slack'",
        )
    supabase_admin.table("user_connections").delete().eq("user_id", user_id).eq(
        "provider", provider
    ).execute()
