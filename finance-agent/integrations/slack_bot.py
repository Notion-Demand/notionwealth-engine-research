"""
Slack integration for NotionWealth Intelligence.

Analysts interact via:
  • Slash command:  /earnings <company name>
  • Slash command:  /earnings <company> --email <addr>   (run + email report)
  • App mention:    @WealthBot analyze <company>
  • App mention:    @WealthBot help

Setup
-----
1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode and generate an App-Level token (SLACK_APP_TOKEN, starts with xapp-)
3. Add a Bot User OAuth Token (SLACK_BOT_TOKEN, starts with xoxb-)
4. Add slash command  /earnings  pointing to your request URL (or just Socket Mode)
5. Subscribe to:  app_mention
6. Set env vars (see .env.example) and run:
       python -m integrations.slack_bot
"""
import asyncio
import logging
import os
import re

from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

from .formatters import format_slack_blocks, format_slack_error, format_slack_help, format_plain_text_summary
from .analysis_runner import run_analysis
from .email_handler import send_report_email, SmtpConfig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App initialisation
# ---------------------------------------------------------------------------

app = AsyncApp(token=os.environ.get("SLACK_BOT_TOKEN", ""))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_email_flag(text: str) -> tuple[str, str | None]:
    """
    Split '--email foo@bar.com' out of the query string.
    Returns (clean_query, email_or_None).
    """
    match = re.search(r"--email\s+(\S+@\S+)", text, re.IGNORECASE)
    if match:
        email = match.group(1).rstrip(".,;")
        clean = re.sub(r"--email\s+\S+", "", text, flags=re.IGNORECASE).strip()
        return clean, email
    return text.strip(), None


def _smtp_config_from_env() -> SmtpConfig | None:
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    if not all([host, user, password]):
        return None
    return SmtpConfig(
        host=host,
        port=int(os.getenv("SMTP_PORT", "587")),
        user=user,
        password=password,
        use_tls=os.getenv("SMTP_USE_TLS", "true").lower() == "true",
    )


async def _run_and_respond(query: str, respond, say=None, channel: str | None = None):
    """
    Core handler shared by slash-command and app-mention flows.
    Parses optional --email flag, runs analysis, posts result.
    """
    clean_query, email_to = _parse_email_flag(query)

    if not clean_query:
        blocks = format_slack_help()
        if respond:
            await respond(blocks=blocks, text="NotionWealth Help")
        elif say and channel:
            await say(blocks=blocks, channel=channel)
        return

    # ACK with a working message (pipeline takes ~25 s)
    working_msg = f"🔍 Running multi-agent analysis for *{clean_query}*… (~25 s)"
    if respond:
        await respond(working_msg)
    elif say and channel:
        await say(working_msg, channel=channel)

    try:
        payload = await run_analysis(clean_query)
    except Exception as exc:
        logger.exception("Pipeline failed")
        blocks = format_slack_error(clean_query, str(exc))
        if respond:
            await respond(blocks=blocks, text=f"Analysis failed: {exc}")
        elif say and channel:
            await say(blocks=blocks, channel=channel)
        return

    # Post Slack report
    blocks = format_slack_blocks(payload)
    fallback_text = (
        f"Earnings analysis: {payload['company_ticker']} "
        f"({payload['quarter_previous']} → {payload['quarter']}) "
        f"— {payload['overall_signal']} signal"
    )
    if respond:
        await respond(blocks=blocks, text=fallback_text)
    elif say and channel:
        await say(blocks=blocks, channel=channel, text=fallback_text)

    # Optional email delivery
    if email_to:
        smtp = _smtp_config_from_env()
        if smtp:
            try:
                send_report_email(to_emails=[email_to], payload=payload, smtp_config=smtp)
                note = f"📧 Report also emailed to `{email_to}`"
            except Exception as exc:
                logger.warning(f"Email delivery failed: {exc}")
                note = f"⚠️ Could not send email to `{email_to}`: {exc}"
        else:
            note = "⚠️ Email requested but SMTP is not configured."

        if respond:
            await respond(note)
        elif say and channel:
            await say(note, channel=channel)


# ---------------------------------------------------------------------------
# /earnings  slash command
# ---------------------------------------------------------------------------

@app.command("/earnings")
async def handle_earnings_command(ack, respond, command):
    """
    /earnings <company name>
    /earnings <company> --email analyst@firm.com
    """
    await ack()
    text = command.get("text", "").strip()
    await _run_and_respond(text, respond=respond)


# ---------------------------------------------------------------------------
# App mention  (@WealthBot …)
# ---------------------------------------------------------------------------

@app.event("app_mention")
async def handle_app_mention(event, say):
    """
    @WealthBot analyze Bharti
    @WealthBot help
    """
    text: str = event.get("text", "")
    channel: str = event.get("channel", "")

    # Strip the bot mention tag <@U…>
    query = re.sub(r"<@[A-Z0-9]+>", "", text).strip()

    if query.lower() in ("help", "?", ""):
        blocks = format_slack_help()
        await say(blocks=blocks, channel=channel)
        return

    # Strip leading verbs: "analyze foo" → "foo"
    query = re.sub(r"^(analyze|analyse|check|run|get|show)\s+", "", query, flags=re.IGNORECASE)
    await _run_and_respond(query, respond=None, say=say, channel=channel)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def _main():
    app_token = os.environ.get("SLACK_APP_TOKEN", "")
    if not app_token:
        raise EnvironmentError("SLACK_APP_TOKEN is required for Socket Mode.")
    handler = AsyncSocketModeHandler(app, app_token)
    logger.info("Starting NotionWealth Slack Bot (Socket Mode)…")
    await handler.start_async()


def start():
    """Start the Slack bot (blocking)."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    asyncio.run(_main())


if __name__ == "__main__":
    start()
