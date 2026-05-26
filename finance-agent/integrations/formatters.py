"""
Output formatters: convert DashboardPayload dict into Slack Block Kit blocks
and HTML email content for analyst-ready reports.
"""
from typing import Any

# Signal/status emoji maps
_SIGNAL_EMOJI = {"Positive": "🟢", "Negative": "🔴", "Mixed": "🟡", "Noise": "⚪"}
_VALIDATION_EMOJI = {"verified": "✅", "flagged": "⚠️", "removed": "❌"}
_MARKET_EMOJI = {"aligned": "📈", "divergent": "📉", "unclear": "❓"}
_SIGNAL_COLOR = {"Positive": "#2eb886", "Negative": "#cc0000", "Mixed": "#e8a838", "Noise": "#888888"}


# ---------------------------------------------------------------------------
# Slack Block Kit formatter
# ---------------------------------------------------------------------------

def format_slack_blocks(payload: dict) -> list[dict[str, Any]]:
    """
    Convert a DashboardPayload dict to Slack Block Kit blocks.
    Designed for slash command / app-mention responses.
    """
    company = payload["company_ticker"]
    q_curr = payload["quarter"]
    q_prev = payload["quarter_previous"]
    overall_signal = payload["overall_signal"]
    overall_score = payload["overall_score"]
    summary = payload["summary"]
    evasiveness = payload["executive_evasiveness_score"]
    validation_score = payload["validation_score"]
    flagged_count = payload["flagged_count"]
    market_pct = payload["market_alignment_pct"]
    stock_change = payload["stock_price_change"]
    insights = payload.get("insights", [])

    sig_emoji = _SIGNAL_EMOJI.get(overall_signal, "⚪")
    stock_arrow = "▲" if stock_change >= 0 else "▼"
    evasiveness_note = "Direct" if evasiveness <= 3 else ("Moderate" if evasiveness <= 6 else "Evasive")

    blocks: list[dict] = [
        # ── Header ──────────────────────────────────────────────────────────
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"Earnings Analysis: {company}  ({q_prev} → {q_curr})",
                "emoji": True,
            },
        },
        # ── Overall signal banner ────────────────────────────────────────────
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"{sig_emoji}  *Overall Signal:* {overall_signal}   "
                    f"|   *Score:* `{overall_score:+.2f} / 10`"
                ),
            },
        },
        # ── Key stats (2×2 grid) ─────────────────────────────────────────────
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Stock Change*\n`{stock_arrow} {abs(stock_change):.1f}%`"},
                {"type": "mrkdwn", "text": f"*Market Alignment*\n`{market_pct:.0f}%`"},
                {"type": "mrkdwn", "text": f"*Validation Score*\n`{validation_score:.0f}%`"},
                {"type": "mrkdwn", "text": f"*Exec Evasiveness*\n`{evasiveness:.1f}/10  ({evasiveness_note})`"},
            ],
        },
        # ── Executive summary ────────────────────────────────────────────────
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Summary*\n{summary}"},
        },
        {"type": "divider"},
    ]

    # ── Per-section insights (up to 4) ──────────────────────────────────────
    for section in insights[:4]:
        section_name = section.get("section_name", "")
        takeaways = section.get("key_takeaways", [])[:3]
        metrics = [m for m in section.get("metrics", []) if m.get("validation_status") != "removed"]

        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*{section_name}*"},
        })

        if takeaways:
            bullets = "\n".join(f"• {t}" for t in takeaways)
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": bullets},
            })

        # Top 2 metrics with quote + shift summary
        for metric in metrics[:2]:
            sig = metric.get("signal_classification", "Noise")
            score = metric.get("signal_score", 0.0)
            subtopic = metric.get("subtopic", "")
            shift = metric.get("language_shift", "")
            mkt = metric.get("market_validation", "unclear")
            m_emoji = _SIGNAL_EMOJI.get(sig, "⚪")
            v_emoji = _VALIDATION_EMOJI.get(metric.get("validation_status", "verified"), "✅")
            mkt_emoji = _MARKET_EMOJI.get(mkt, "❓")

            blocks.append({
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": (
                            f"{m_emoji} *{subtopic}* (Score: `{score:+.1f}`)  "
                            f"{v_emoji}  {mkt_emoji}  —  _{shift}_"
                        ),
                    }
                ],
            })

        blocks.append({"type": "divider"})

    # ── Footer ────────────────────────────────────────────────────────────────
    footer_parts = ["_NotionWealth Intelligence Engine  |  Multi-Agent Analysis_"]
    if flagged_count > 0:
        footer_parts.insert(0, f"⚠️ {flagged_count} metric(s) flagged by validation agent")

    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": "  |  ".join(footer_parts)}],
    })

    return blocks


def format_slack_error(query: str, error: str) -> list[dict[str, Any]]:
    """Minimal Slack error block."""
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"❌ *Analysis failed for query:* `{query}`\n>{error}",
            },
        }
    ]


def format_slack_help() -> list[dict[str, Any]]:
    """Help block listing available companies and usage."""
    from multiagent_analysis.parser import list_available_companies
    try:
        companies = list_available_companies()
        co_list = ", ".join(f"`{c}`" for c in companies) if companies else "_none loaded yet_"
    except Exception:
        co_list = "_could not load_"

    return [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "NotionWealth — Earnings Analysis Bot"},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "*Usage*\n"
                    "• `/earnings <company name>` — run earnings diff report\n"
                    "• `/earnings <company> --email <addr>` — run report and email it\n"
                    "• `@WealthBot analyze <company>` — same as slash command\n\n"
                    f"*Available companies:*  {co_list}"
                ),
            },
        },
    ]


# ---------------------------------------------------------------------------
# HTML Email formatter
# ---------------------------------------------------------------------------

def format_html_email(payload: dict) -> tuple[str, str]:
    """
    Convert a DashboardPayload dict to (subject, html_body).
    Returns a self-contained, inline-styled HTML email.
    """
    company = payload["company_ticker"]
    q_curr = payload["quarter"]
    q_prev = payload["quarter_previous"]
    overall_signal = payload["overall_signal"]
    overall_score = payload["overall_score"]
    summary = payload["summary"]
    evasiveness = payload["executive_evasiveness_score"]
    validation_score = payload["validation_score"]
    flagged_count = payload["flagged_count"]
    market_pct = payload["market_alignment_pct"]
    stock_change = payload["stock_price_change"]
    insights = payload.get("insights", [])

    sig_color = _SIGNAL_COLOR.get(overall_signal, "#888888")
    sig_emoji = _SIGNAL_EMOJI.get(overall_signal, "")
    stock_sign = "+" if stock_change >= 0 else ""

    subject = (
        f"[NotionWealth] {company} Earnings Analysis ({q_prev} → {q_curr})"
        f" — {sig_emoji} {overall_signal} Signal"
    )

    # ── Build section HTML ───────────────────────────────────────────────────
    sections_html = ""
    for section in insights:
        section_name = section.get("section_name", "")
        takeaways = section.get("key_takeaways", [])[:4]
        metrics = [m for m in section.get("metrics", []) if m.get("validation_status") != "removed"]

        takeaway_items = "".join(f"<li>{t}</li>" for t in takeaways)

        metric_rows = ""
        for metric in metrics[:3]:
            sig = metric.get("signal_classification", "Noise")
            score = metric.get("signal_score", 0.0)
            subtopic = metric.get("subtopic", "")
            shift = metric.get("language_shift", "")
            quote_old = metric.get("quote_old", "")[:200]
            quote_new = metric.get("quote_new", "")[:200]
            mkt_note = metric.get("market_note", "")
            v_status = metric.get("validation_status", "verified")

            row_color = _SIGNAL_COLOR.get(sig, "#888")
            v_badge = {"verified": "✅ Verified", "flagged": "⚠️ Flagged", "removed": "❌ Removed"}.get(
                v_status, v_status
            )

            metric_rows += f"""
            <tr style="border-top:1px solid #eee;">
              <td style="padding:10px 8px;font-weight:600;color:{row_color};white-space:nowrap;">
                {subtopic}
              </td>
              <td style="padding:10px 8px;color:#444;">
                <span style="color:{row_color};font-weight:600;">{sig}  ({score:+.1f})</span><br/>
                <em style="color:#666;">{shift}</em>
              </td>
              <td style="padding:10px 8px;font-size:12px;color:#555;">
                <b>Before:</b> <span style="color:#666;">"{quote_old}"</span><br/>
                <b>After:</b> <span style="color:#333;">"{quote_new}"</span>
              </td>
              <td style="padding:10px 8px;font-size:12px;color:#555;">
                {v_badge}<br/>{mkt_note}
              </td>
            </tr>"""

        sections_html += f"""
        <div style="margin:24px 0;">
          <h3 style="margin:0 0 10px;color:#1a1a2e;border-bottom:2px solid #e8e8f0;padding-bottom:6px;">
            {section_name}
          </h3>
          <ul style="margin:0 0 12px;padding-left:20px;color:#444;line-height:1.7;">
            {takeaway_items}
          </ul>
          {"" if not metric_rows else f'''
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f5f5fb;text-align:left;">
                <th style="padding:8px;color:#555;font-weight:600;">Subtopic</th>
                <th style="padding:8px;color:#555;font-weight:600;">Signal</th>
                <th style="padding:8px;color:#555;font-weight:600;">Quote Change</th>
                <th style="padding:8px;color:#555;font-weight:600;">Validation</th>
              </tr>
            </thead>
            <tbody>{metric_rows}</tbody>
          </table>
          '''}
        </div>"""

    flagged_warning = (
        f'<p style="color:#b45309;background:#fffbeb;padding:10px 14px;border-radius:6px;border-left:4px solid #f59e0b;">'
        f"⚠️ {flagged_count} metric(s) were flagged or removed by the validation agent.</p>"
        if flagged_count > 0
        else ""
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>{subject}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f0f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f5;padding:32px 0;">
    <tr><td align="center">
      <table width="680" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header bar -->
        <tr>
          <td style="background:{sig_color};padding:20px 32px;">
            <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">
              {company} — Earnings Analysis
            </h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
              {q_prev} &rarr; {q_curr}
            </p>
          </td>
        </tr>

        <!-- Signal badge -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:{sig_color}18;border:1px solid {sig_color}44;border-radius:8px;padding:10px 20px;">
                  <span style="font-size:22px;">{sig_emoji}</span>
                  <span style="font-size:16px;font-weight:700;color:{sig_color};margin-left:8px;">
                    {overall_signal} Signal
                  </span>
                  <span style="color:#888;margin-left:12px;font-size:14px;">
                    Score: {overall_score:+.2f}/10
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- KPI stats row -->
        <tr>
          <td style="padding:20px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background:#f8f9fc;border-radius:8px;padding:14px;width:25%;">
                  <div style="font-size:20px;font-weight:700;color:#1a1a2e;">{stock_sign}{stock_change:.1f}%</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;">Stock Change</div>
                </td>
                <td width="12"></td>
                <td align="center" style="background:#f8f9fc;border-radius:8px;padding:14px;width:25%;">
                  <div style="font-size:20px;font-weight:700;color:#1a1a2e;">{market_pct:.0f}%</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;">Market Alignment</div>
                </td>
                <td width="12"></td>
                <td align="center" style="background:#f8f9fc;border-radius:8px;padding:14px;width:25%;">
                  <div style="font-size:20px;font-weight:700;color:#1a1a2e;">{validation_score:.0f}%</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;">Validation Score</div>
                </td>
                <td width="12"></td>
                <td align="center" style="background:#f8f9fc;border-radius:8px;padding:14px;width:25%;">
                  <div style="font-size:20px;font-weight:700;color:#1a1a2e;">{evasiveness:.1f}/10</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;">Exec Evasiveness</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Summary -->
        <tr>
          <td style="padding:20px 32px 0;">
            <div style="background:#f8f9fc;border-left:4px solid {sig_color};border-radius:0 8px 8px 0;padding:14px 18px;">
              <div style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">
                Executive Summary
              </div>
              <p style="margin:0;color:#333;line-height:1.65;">{summary}</p>
            </div>
          </td>
        </tr>

        <!-- Sections -->
        <tr>
          <td style="padding:20px 32px;">
            {flagged_warning}
            {sections_html}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#1a1a2e;padding:16px 32px;text-align:center;">
            <p style="margin:0;color:#8888aa;font-size:12px;">
              NotionWealth Intelligence Engine &nbsp;|&nbsp; Multi-Agent Earnings Analysis
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

    return subject, html


def format_plain_text_summary(payload: dict) -> str:
    """Compact plain-text summary (used as email fallback and logging)."""
    company = payload["company_ticker"]
    q_curr = payload["quarter"]
    q_prev = payload["quarter_previous"]
    overall_signal = payload["overall_signal"]
    overall_score = payload["overall_score"]
    summary = payload["summary"]
    stock_change = payload["stock_price_change"]
    market_pct = payload["market_alignment_pct"]
    validation_score = payload["validation_score"]

    lines = [
        f"{'='*60}",
        f"EARNINGS ANALYSIS: {company}  ({q_prev} → {q_curr})",
        f"{'='*60}",
        f"Overall Signal : {overall_signal}  (Score: {overall_score:+.2f}/10)",
        f"Stock Change   : {stock_change:+.1f}%",
        f"Market Align   : {market_pct:.0f}%",
        f"Validation     : {validation_score:.0f}%",
        "",
        "SUMMARY",
        summary,
        "",
    ]

    for section in payload.get("insights", []):
        lines.append(f"--- {section['section_name']} ---")
        for t in section.get("key_takeaways", [])[:3]:
            lines.append(f"  • {t}")
        lines.append("")

    lines.append("NotionWealth Intelligence Engine")
    return "\n".join(lines)
