"""
Email integration for NotionWealth Intelligence.

Outbound: send HTML earnings reports via SMTP.
Inbound:  poll an IMAP inbox for analyst query emails and process them
          automatically, replying with the generated report.

Environment variables (all optional — only needed for the feature used):
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_USE_TLS
  IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS
  IMAP_POLL_INTERVAL_SECONDS  (default: 60)
  EMAIL_FROM_NAME             (default: "NotionWealth Intelligence")

Run the IMAP poller as a standalone service:
  python -m integrations.email_handler
"""
import asyncio
import email as email_lib
import email.utils
import imaplib
import logging
import os
import smtplib
import textwrap
import time
from dataclasses import dataclass, field
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from .formatters import format_html_email, format_plain_text_summary

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config dataclasses
# ---------------------------------------------------------------------------

@dataclass
class SmtpConfig:
    host: str
    port: int = 587
    user: str = ""
    password: str = ""
    use_tls: bool = True
    from_name: str = "NotionWealth Intelligence"

    @classmethod
    def from_env(cls) -> Optional["SmtpConfig"]:
        host = os.getenv("SMTP_HOST")
        user = os.getenv("SMTP_USER")
        password = os.getenv("SMTP_PASS")
        if not all([host, user, password]):
            return None
        return cls(
            host=host,
            port=int(os.getenv("SMTP_PORT", "587")),
            user=user,
            password=password,
            use_tls=os.getenv("SMTP_USE_TLS", "true").lower() == "true",
            from_name=os.getenv("EMAIL_FROM_NAME", "NotionWealth Intelligence"),
        )


@dataclass
class ImapConfig:
    host: str
    port: int = 993
    user: str = ""
    password: str = ""
    poll_interval: int = 60
    mailbox: str = "INBOX"

    @classmethod
    def from_env(cls) -> Optional["ImapConfig"]:
        host = os.getenv("IMAP_HOST")
        user = os.getenv("IMAP_USER")
        password = os.getenv("IMAP_PASS")
        if not all([host, user, password]):
            return None
        return cls(
            host=host,
            port=int(os.getenv("IMAP_PORT", "993")),
            user=user,
            password=password,
            poll_interval=int(os.getenv("IMAP_POLL_INTERVAL_SECONDS", "60")),
        )


# ---------------------------------------------------------------------------
# Outbound: send report via SMTP
# ---------------------------------------------------------------------------

def send_report_email(
    to_emails: list[str],
    payload: dict,
    smtp_config: SmtpConfig,
    cc_emails: list[str] | None = None,
) -> None:
    """
    Send a formatted HTML earnings report email to one or more recipients.

    Args:
        to_emails:   Primary recipient list.
        payload:     DashboardPayload dict from the analysis pipeline.
        smtp_config: SMTP credentials and settings.
        cc_emails:   Optional CC list.
    """
    subject, html_body = format_html_email(payload)
    plain_body = format_plain_text_summary(payload)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = email.utils.formataddr((smtp_config.from_name, smtp_config.user))
    msg["To"] = ", ".join(to_emails)
    if cc_emails:
        msg["Cc"] = ", ".join(cc_emails)

    msg.attach(MIMEText(plain_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    all_recipients = to_emails + (cc_emails or [])

    try:
        if smtp_config.use_tls:
            server = smtplib.SMTP(smtp_config.host, smtp_config.port, timeout=30)
            server.ehlo()
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(smtp_config.host, smtp_config.port, timeout=30)

        server.login(smtp_config.user, smtp_config.password)
        server.sendmail(smtp_config.user, all_recipients, msg.as_string())
        server.quit()
        logger.info(f"Email sent to {all_recipients}: {subject}")
    except Exception:
        logger.exception(f"Failed to send email to {all_recipients}")
        raise


# ---------------------------------------------------------------------------
# Inbound: IMAP poller
# ---------------------------------------------------------------------------

def _extract_query_from_email(msg: email_lib.message.Message) -> str:
    """
    Extract the earnings query from an inbound email.
    Strategy: use Subject first; if it looks like a generic subject, fall back
    to the first non-empty line of the body.
    """
    subject = msg.get("Subject", "").strip()

    # If subject clearly contains a company name, use it directly
    generic_subjects = {"earnings", "query", "analyze", "analyse", "report", ""}
    if subject.lower() not in generic_subjects and len(subject) > 2:
        return subject

    # Fall back to body
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                try:
                    body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                    break
                except Exception:
                    pass
    else:
        try:
            body = msg.get_payload(decode=True).decode("utf-8", errors="replace")
        except Exception:
            pass

    # Return first meaningful line
    for line in body.splitlines():
        line = line.strip()
        if line and not line.startswith(">"):  # skip quoted lines
            return line

    return subject  # fall back to subject even if it was generic


class ImapPoller:
    """
    Polls an IMAP inbox for unread messages addressed to the integration
    mailbox, extracts the earnings query, runs the analysis pipeline,
    and replies with the formatted HTML report.

    Usage:
        poller = ImapPoller(imap_config, smtp_config)
        poller.run()   # blocking
    """

    def __init__(self, imap_config: ImapConfig, smtp_config: SmtpConfig):
        self.imap = imap_config
        self.smtp = smtp_config

    # ── Internal IMAP helpers ────────────────────────────────────────────────

    def _connect(self) -> imaplib.IMAP4_SSL:
        conn = imaplib.IMAP4_SSL(self.imap.host, self.imap.port)
        conn.login(self.imap.user, self.imap.password)
        conn.select(self.imap.mailbox)
        return conn

    def _fetch_unread(self, conn: imaplib.IMAP4_SSL) -> list[tuple[bytes, email_lib.message.Message]]:
        """Fetch unread messages. Returns list of (uid, parsed_message)."""
        _, data = conn.search(None, "UNSEEN")
        uids = data[0].split()
        messages = []
        for uid in uids:
            _, msg_data = conn.fetch(uid, "(RFC822)")
            if msg_data and msg_data[0]:
                raw = msg_data[0][1]
                parsed = email_lib.message_from_bytes(raw)
                messages.append((uid, parsed))
        return messages

    def _mark_seen(self, conn: imaplib.IMAP4_SSL, uid: bytes) -> None:
        conn.store(uid, "+FLAGS", "\\Seen")

    # ── Per-email processing ─────────────────────────────────────────────────

    def _process_message(self, uid: bytes, msg: email_lib.message.Message, conn: imaplib.IMAP4_SSL) -> None:
        from_addr = email.utils.parseaddr(msg.get("From", ""))[1]
        query = _extract_query_from_email(msg)
        logger.info(f"Processing email from {from_addr}: '{query}'")

        try:
            # Run the analysis pipeline synchronously (IMAP poller is a blocking thread)
            from .analysis_runner import run_analysis_sync
            payload = run_analysis_sync(query)
        except Exception as exc:
            logger.warning(f"Analysis failed for '{query}': {exc}")
            self._send_error_reply(from_addr, query, str(exc))
            self._mark_seen(conn, uid)
            return

        try:
            send_report_email(
                to_emails=[from_addr],
                payload=payload,
                smtp_config=self.smtp,
            )
        except Exception:
            logger.exception(f"Failed to reply to {from_addr}")

        self._mark_seen(conn, uid)

    def _send_error_reply(self, to: str, query: str, error: str) -> None:
        """Send a plain-text error reply when analysis fails."""
        msg = MIMEText(
            textwrap.dedent(f"""\
            Hi,

            Your earnings analysis request could not be completed.

            Query:  {query}
            Error:  {error}

            Please check that the company name matches one of the loaded tickers
            and that the required PDF transcripts are available.

            — NotionWealth Intelligence Engine
            """),
            "plain",
        )
        msg["Subject"] = f"[NotionWealth] Analysis Failed: {query}"
        msg["From"] = email.utils.formataddr((self.smtp.from_name, self.smtp.user))
        msg["To"] = to
        try:
            if self.smtp.use_tls:
                server = smtplib.SMTP(self.smtp.host, self.smtp.port, timeout=30)
                server.ehlo()
                server.starttls()
            else:
                server = smtplib.SMTP_SSL(self.smtp.host, self.smtp.port, timeout=30)
            server.login(self.smtp.user, self.smtp.password)
            server.sendmail(self.smtp.user, [to], msg.as_string())
            server.quit()
        except Exception:
            logger.exception("Could not send error reply")

    # ── Main polling loop ────────────────────────────────────────────────────

    def poll_once(self) -> int:
        """Poll inbox once. Returns the number of messages processed."""
        try:
            conn = self._connect()
            messages = self._fetch_unread(conn)
            for uid, msg in messages:
                self._process_message(uid, msg, conn)
            conn.logout()
            return len(messages)
        except Exception:
            logger.exception("IMAP poll failed")
            return 0

    def run(self) -> None:
        """Blocking poll loop. Runs forever until interrupted."""
        logger.info(
            f"IMAP poller started — checking {self.imap.user}@{self.imap.host} "
            f"every {self.imap.poll_interval}s"
        )
        while True:
            n = self.poll_once()
            if n:
                logger.info(f"Processed {n} email(s)")
            time.sleep(self.imap.poll_interval)


# ---------------------------------------------------------------------------
# Convenience: send report to a static analyst list
# ---------------------------------------------------------------------------

def broadcast_report(payload: dict, analyst_emails: list[str]) -> None:
    """
    Send an earnings report to a fixed list of analyst addresses.
    Reads SMTP config from environment variables.
    Useful for scheduled / batch delivery.
    """
    smtp = SmtpConfig.from_env()
    if not smtp:
        raise EnvironmentError("SMTP environment variables not configured.")
    send_report_email(to_emails=analyst_emails, payload=payload, smtp_config=smtp)


# ---------------------------------------------------------------------------
# Entry point (run IMAP poller as a service)
# ---------------------------------------------------------------------------

def start():
    """Start the IMAP email poller (blocking)."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")

    smtp = SmtpConfig.from_env()
    imap = ImapConfig.from_env()

    if not smtp:
        raise EnvironmentError(
            "SMTP_HOST, SMTP_USER, SMTP_PASS must be set to run the email integration."
        )
    if not imap:
        raise EnvironmentError(
            "IMAP_HOST, IMAP_USER, IMAP_PASS must be set to run the IMAP poller."
        )

    poller = ImapPoller(imap_config=imap, smtp_config=smtp)
    poller.run()


if __name__ == "__main__":
    start()
