"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { sendEmail } from "@/lib/api";

interface EarningsReportProps {
  payload: Record<string, unknown>;
}

export default function EarningsReport({ payload }: EarningsReportProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailTarget, setEmailTarget] = useState("");

  const result = (payload.result as string | undefined) ?? JSON.stringify(payload, null, 2);
  const query = (payload.query as string | undefined) ?? "Analysis";

  async function handleSendEmail() {
    if (!emailTarget) {
      alert("Enter a recipient email address.");
      return;
    }
    setSending(true);
    try {
      await sendEmail({
        to: emailTarget,
        subject: `NotionWealth: ${query}`,
        body: result,
      });
      setSent(true);
    } catch (err) {
      alert(`Failed to send: ${err}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 font-medium text-gray-900">Analysis Result</h3>
      <pre className="whitespace-pre-wrap rounded bg-gray-50 p-4 text-sm text-gray-700 overflow-auto max-h-96">
        {result}
      </pre>

      {/* Send via Gmail */}
      <div className="mt-4 flex items-center gap-2">
        <input
          type="email"
          value={emailTarget}
          onChange={(e) => setEmailTarget(e.target.value)}
          placeholder="Recipient email"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={handleSendEmail}
          disabled={sending || sent}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Mail size={14} />
          {sent ? "Sent!" : sending ? "Sending…" : "Send via Gmail"}
        </button>
      </div>
    </div>
  );
}
