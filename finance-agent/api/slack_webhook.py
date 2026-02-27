"""
POST /slack/command — Multi-tenant Slack slash command handler.

Flow:
1. Slack sends a signed POST to this endpoint when a user types /earnings <ticker>
2. Verify HMAC signature using the app's signing secret
3. Look up the workspace (team_id) → find the associated user in user_connections
4. Run the analysis pipeline
5. Post the result back to Slack using the stored bot token

Setup requirements:
- Slack app: Slash Command /earnings  →  Request URL: https://your-domain.com/slack/command
- Slack app: Bot Token Scopes: chat:write
"""

import hashlib
import hmac
import os
import time
from typing import Annotated

from dotenv import load_dotenv
from fastapi import APIRouter, Form, Header, HTTPException, Request, status

from db.supabase import supabase_admin

load_dotenv()

_SIGNING_SECRET = os.environ.get("SLACK_SIGNING_SECRET", "")

router = APIRouter(prefix="/slack", tags=["slack"])


@router.post("/command")
async def slack_command(
    request: Request,
    # Slack sends form-encoded body
    command: str = Form(...),
    text: str = Form(default=""),
    team_id: str = Form(...),
    response_url: str = Form(...),
    x_slack_request_timestamp: Annotated[str, Header()] = "",
    x_slack_signature: Annotated[str, Header()] = "",
):
    """Handle /earnings <ticker> slash command."""
    # 1. Verify Slack request signature
    body = await request.body()
    _verify_slack_signature(
        body=body,
        timestamp=x_slack_request_timestamp,
        signature=x_slack_signature,
    )

    ticker = text.strip().upper() or "UNKNOWN"

    # 2. Look up user by team_id
    conn = _get_connection_by_team(team_id)
    bot_token: str = conn["slack_bot_token"]

    # 3. Run pipeline (synchronous — Slack gives us 3s for immediate response)
    query = f"Analyze {ticker} latest earnings"
    try:
        from vertex import call_gemini  # type: ignore[import]
        result = call_gemini(query)
        result_text = str(result)[:3000]  # Slack block limit
    except Exception as exc:
        result_text = f"Pipeline error: {exc}"

    # 4. Post back to Slack channel via response_url (deferred response)
    import httpx  # type: ignore[import]

    async with httpx.AsyncClient() as client:
        await client.post(
            response_url,
            json={
                "response_type": "in_channel",
                "text": f"*Earnings Analysis — {ticker}*\n\n{result_text}",
            },
            headers={"Authorization": f"Bearer {bot_token}"},
            timeout=10,
        )

    # Immediate ack to Slack (must be <3s)
    return {"response_type": "ephemeral", "text": f"Fetching analysis for {ticker}..."}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _verify_slack_signature(body: bytes, timestamp: str, signature: str) -> None:
    """Raise 401 if the request is not from Slack."""
    if not _SIGNING_SECRET:
        return  # skip in dev if not configured

    # Reject replays older than 5 minutes
    try:
        ts = int(timestamp)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad timestamp")

    if abs(time.time() - ts) > 300:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Stale request")

    base = f"v0:{timestamp}:{body.decode()}"
    expected = "v0=" + hmac.new(
        _SIGNING_SECRET.encode(), base.encode(), hashlib.sha256
    ).hexdigest()  # hmac.new = hmac.HMAC constructor alias

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")


def _get_connection_by_team(team_id: str) -> dict:
    result = (
        supabase_admin.table("user_connections")
        .select("slack_bot_token, user_id")
        .eq("provider", "slack")
        .eq("slack_team_id", team_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No user found for Slack team {team_id}",
        )
    return result.data
