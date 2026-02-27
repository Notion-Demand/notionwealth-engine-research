"use client";

import { useEffect, useState, useCallback } from "react";
import Nav from "@/components/Nav";
import ConnectionCard from "@/components/ConnectionCard";
import { listConnections, type Connection } from "@/lib/api";

interface ConnectionsClientProps {
  userId: string;
}

function buildGoogleOAuthUrl(userId: string): string {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
    redirect_uri: `${window.location.origin}/api/auth/google/callback`,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state: userId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function buildSlackOAuthUrl(userId: string): string {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_SLACK_CLIENT_ID ?? "",
    scope: "commands,chat:write,channels:history",
    redirect_uri: `${window.location.origin}/api/auth/slack/callback`,
    state: userId,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export default function ConnectionsClient({ userId }: ConnectionsClientProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listConnections();
      setConnections(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const gmail = connections.find((c) => c.provider === "gmail");
  const slack = connections.find((c) => c.provider === "slack");

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h2 className="mb-2 text-xl font-semibold">Connections</h2>
        <p className="mb-8 text-sm text-gray-500">
          Connect your Gmail and Slack accounts to enable email reports and the
          earnings slash command.
        </p>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="space-y-4">
            <ConnectionCard
              provider="gmail"
              label="Gmail"
              description="Send analysis reports directly from your Gmail account."
              connectUrl={buildGoogleOAuthUrl(userId)}
              connected={!!gmail}
              connectedLabel={gmail ? `Connected as ${gmail.gmail_email}` : undefined}
              onDisconnect={load}
            />
            <ConnectionCard
              provider="slack"
              label="Slack"
              description="Install the /earnings slash command in your Slack workspace."
              connectUrl={buildSlackOAuthUrl(userId)}
              connected={!!slack}
              connectedLabel={
                slack ? `Connected to ${slack.slack_team_name}` : undefined
              }
              onDisconnect={load}
            />
          </div>
        )}
      </main>
    </>
  );
}
