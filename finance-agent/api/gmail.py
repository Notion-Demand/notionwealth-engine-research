"""
POST /email/send — Send an email via the user's connected Gmail account.

Retrieves the stored OAuth tokens for the caller, refreshes if expired,
then calls the Gmail API to send the message.
"""

import base64
import email.mime.text
import os
from datetime import timezone
from typing import Annotated

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from api.auth import get_current_user
from db.supabase import supabase_admin

load_dotenv()

_GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
_GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

router = APIRouter(prefix="/email", tags=["email"])


class SendEmailRequest(BaseModel):
    to: EmailStr
    subject: str
    body: str  # Plain-text or HTML
    body_type: str = "plain"  # "plain" | "html"


@router.post("/send", status_code=status.HTTP_200_OK)
async def send_email(
    req: SendEmailRequest,
    user_id: Annotated[str, Depends(get_current_user)],
):
    """Send an email via the caller's connected Gmail account."""
    # Lazy imports — heavy libs not needed at startup
    from google.auth.transport.requests import Request  # type: ignore[import]
    from google.oauth2.credentials import Credentials  # type: ignore[import]
    from googleapiclient.discovery import build  # type: ignore[import]

    conn = _get_gmail_connection(user_id)

    creds = Credentials(
        token=conn["gmail_access_token"],
        refresh_token=conn["gmail_refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=_GOOGLE_CLIENT_ID,
        client_secret=_GOOGLE_CLIENT_SECRET,
    )

    # Refresh if expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _update_stored_token(user_id, creds)

    service = build("gmail", "v1", credentials=creds, cache_discovery=False)

    message = email.mime.text.MIMEText(req.body, req.body_type)
    message["to"] = req.to
    message["from"] = conn["gmail_email"]
    message["subject"] = req.subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

    service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return {"status": "sent", "to": req.to}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_gmail_connection(user_id: str) -> dict:
    result = (
        supabase_admin.table("user_connections")
        .select(
            "gmail_email, gmail_access_token, gmail_refresh_token, gmail_token_expiry"
        )
        .eq("user_id", user_id)
        .eq("provider", "gmail")
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gmail not connected. Go to Settings → Connections.",
        )
    return result.data


def _update_stored_token(user_id: str, creds) -> None:
    from google.oauth2.credentials import Credentials  # type: ignore[import]

    expiry_iso = (
        creds.expiry.replace(tzinfo=timezone.utc).isoformat()
        if creds.expiry
        else None
    )
    supabase_admin.table("user_connections").update(
        {
            "gmail_access_token": creds.token,
            "gmail_token_expiry": expiry_iso,
        }
    ).eq("user_id", user_id).eq("provider", "gmail").execute()
