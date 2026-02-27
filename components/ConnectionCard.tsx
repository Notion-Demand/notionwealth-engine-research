"use client";

import { useState } from "react";
import { CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { deleteConnection } from "@/lib/api";

interface ConnectionCardProps {
  provider: "gmail" | "slack";
  label: string;
  description: string;
  connectUrl: string;
  connected: boolean;
  connectedLabel?: string;
  onDisconnect?: () => void;
}

export default function ConnectionCard({
  provider,
  label,
  description,
  connectUrl,
  connected,
  connectedLabel,
  onDisconnect,
}: ConnectionCardProps) {
  const [loading, setLoading] = useState(false);

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${label}?`)) return;
    setLoading(true);
    try {
      await deleteConnection(provider);
      onDisconnect?.();
    } catch (err) {
      alert(`Error disconnecting: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-gray-900">{label}</h3>
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
          {connected && connectedLabel && (
            <p className="mt-1 text-xs text-gray-400">{connectedLabel}</p>
          )}
        </div>
        {connected ? (
          <CheckCircle className="mt-0.5 shrink-0 text-green-500" size={20} />
        ) : (
          <XCircle className="mt-0.5 shrink-0 text-gray-300" size={20} />
        )}
      </div>

      <div className="mt-4">
        {connected ? (
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            {loading ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <a
            href={connectUrl}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Connect
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
