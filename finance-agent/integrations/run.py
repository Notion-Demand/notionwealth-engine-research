"""
Launch script: starts the Slack bot and the IMAP email poller together.

Usage
-----
  # Both integrations:
  python -m integrations.run

  # Slack only:
  python -m integrations.run --slack

  # Email poller only:
  python -m integrations.run --email

Environment variables required:
  Slack:  SLACK_BOT_TOKEN, SLACK_APP_TOKEN
  Email:  SMTP_HOST, SMTP_USER, SMTP_PASS, IMAP_HOST, IMAP_USER, IMAP_PASS
"""
import argparse
import logging
import os
import sys
import threading

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger(__name__)


def _slack_available() -> bool:
    return bool(os.getenv("SLACK_BOT_TOKEN") and os.getenv("SLACK_APP_TOKEN"))


def _email_available() -> bool:
    return bool(
        os.getenv("SMTP_HOST")
        and os.getenv("SMTP_USER")
        and os.getenv("SMTP_PASS")
        and os.getenv("IMAP_HOST")
        and os.getenv("IMAP_USER")
        and os.getenv("IMAP_PASS")
    )


def _start_email_poller():
    """Run IMAP poller in a daemon thread."""
    from integrations.email_handler import ImapConfig, ImapPoller, SmtpConfig

    smtp = SmtpConfig.from_env()
    imap = ImapConfig.from_env()
    if not smtp or not imap:
        logger.error("Email poller: missing SMTP/IMAP environment variables — skipping.")
        return

    poller = ImapPoller(imap_config=imap, smtp_config=smtp)

    t = threading.Thread(target=poller.run, daemon=True, name="email-poller")
    t.start()
    logger.info("Email poller started in background thread.")
    return t


def main():
    parser = argparse.ArgumentParser(description="NotionWealth Integration Runner")
    parser.add_argument("--slack", action="store_true", help="Run Slack bot only")
    parser.add_argument("--email", action="store_true", help="Run email poller only")
    args = parser.parse_args()

    run_slack = args.slack or (not args.email)
    run_email = args.email or (not args.slack)

    if run_email and _email_available():
        _start_email_poller()
    elif run_email:
        logger.warning("Email integration not started: missing SMTP/IMAP env vars.")

    if run_slack and _slack_available():
        # Runs the async Slack bot in the main thread (blocking)
        from integrations.slack_bot import start as start_slack
        start_slack()
    elif run_slack:
        logger.error(
            "Slack bot not started: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set."
        )
        if not run_email:
            sys.exit(1)
        else:
            # Email-only mode — keep main thread alive while poller runs
            logger.info("Running email poller only. Press Ctrl-C to stop.")
            try:
                threading.Event().wait()
            except KeyboardInterrupt:
                logger.info("Shutting down.")


if __name__ == "__main__":
    main()
