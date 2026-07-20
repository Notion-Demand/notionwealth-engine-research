import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "API Docs — Quantalyze",
  description:
    "Quantalyze Public API v1 reference: authentication, endpoints, rate limits, and error handling.",
};

const BASE_URL = "https://quantalyze.me/api/public/v1";
const CALENDLY = "https://calendly.com/quantalyze/say-hi";

function highlightJson(code: string): ReactNode {
  const regex =
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(code.slice(lastIndex, match.index));
    }
    const token = match[0];
    let className = "text-amber-300";
    if (token.startsWith('"')) {
      className = /:\s*$/.test(token) ? "text-sky-400" : "text-emerald-400";
    } else if (token === "true" || token === "false") {
      className = "text-purple-400";
    } else if (token === "null") {
      className = "text-white/30";
    }
    nodes.push(
      <span key={key++} className={className}>
        {token}
      </span>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < code.length) {
    nodes.push(code.slice(lastIndex));
  }
  return nodes;
}

function highlightBash(code: string): ReactNode {
  const regex = /(--?[a-zA-Z-]+|"[^"]*")/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(code.slice(lastIndex, match.index));
    }
    const token = match[0];
    const className = token.startsWith("-") ? "text-sky-400" : "text-emerald-400";
    nodes.push(
      <span key={key++} className={className}>
        {token}
      </span>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < code.length) {
    nodes.push(code.slice(lastIndex));
  }
  return nodes;
}

function CodeBlock({ code, lang }: { code: string; lang: "bash" | "json" }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/5">
      <pre className="px-4 py-3 text-[13px] leading-relaxed">
        <code className="font-mono text-white/80">
          {lang === "json" ? highlightJson(code) : highlightBash(code)}
        </code>
      </pre>
    </div>
  );
}

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Nav */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-white">
          Quantalyze
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-12">
        <h1 className="mb-2 text-3xl font-bold text-white">API Docs</h1>
        <p className="mb-12 text-sm text-white/40">Quantalyze Public API — v1</p>

        <div className="space-y-14 text-[15px] leading-relaxed text-white/70">

          {/* Intro */}
          <section>
            <p>
              The Quantalyze API gives you programmatic access to the same
              management-credibility and narrative-shift intelligence that powers
              the Quantalyze product — earnings signal scores, sector dimensions,
              and sector thesis narratives for Indian equities. It&apos;s built for
              research desks, PMS/AIF teams, and platforms that want to embed this
              intelligence directly into their own workflow.
            </p>
          </section>

          {/* Base URL */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Base URL</h2>
            <p className="mb-3">Every endpoint below is relative to:</p>
            <CodeBlock code={BASE_URL} lang="bash" />
          </section>

          {/* Authentication */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Authentication</h2>
            <p className="mb-3">Every request must include your API key as a bearer token:</p>
            <CodeBlock code="Authorization: Bearer YOUR_API_KEY" lang="bash" />
            <p className="mt-4 mb-2">Requests fail before reaching any endpoint logic when:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code className="rounded bg-white/10 px-1 text-xs">401</code> — the{" "}
                <code className="rounded bg-white/10 px-1 text-xs">Authorization</code> header is
                missing or malformed
              </li>
              <li>
                <code className="rounded bg-white/10 px-1 text-xs">401</code> — the API key is
                invalid or has been deactivated
              </li>
              <li>
                <code className="rounded bg-white/10 px-1 text-xs">403</code> — the key is valid
                but not entitled to the requested product (
                <code className="rounded bg-white/10 px-1 text-xs">
                  key is not entitled to &apos;&lt;product&gt;&apos; — contact us to add this
                  product
                </code>
                )
              </li>
            </ul>
            <p className="mt-4">
              API keys are provisioned manually — see{" "}
              <Link href="#get-access" className="text-sky-400 hover:underline">
                Get API access
              </Link>{" "}
              below.
            </p>
          </section>

        </div>
      </main>
    </div>
  );
}
