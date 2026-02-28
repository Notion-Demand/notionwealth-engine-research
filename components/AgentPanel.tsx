"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { quarterLabel } from "@/lib/nifty50";

export type AgentStatus = "idle" | "running" | "done" | "error";

export interface AgentPanelState {
  sections: string[];
  prevStatus: Record<string, AgentStatus>;
  currStatus: Record<string, AgentStatus>;
  deltaStatus: Record<string, AgentStatus>;
  evasivenessStatus: AgentStatus;
  evasivenessScore: number | null;
  stockStatus: AgentStatus;
  stockChange: number | null;
  phase: "idle" | "extracting" | "thematic" | "delta" | "finalizing";
}

export function makeInitialAgentState(sections: string[]): AgentPanelState {
  const blank = Object.fromEntries(sections.map((s) => [s, "idle" as AgentStatus]));
  return {
    sections,
    prevStatus: { ...blank },
    currStatus: { ...blank },
    deltaStatus: { ...blank },
    evasivenessStatus: "idle",
    evasivenessScore: null,
    stockStatus: "idle",
    stockChange: null,
    phase: "extracting",
  };
}

const SECTION_ICONS: Record<string, string> = {
  "Capital & Liquidity": "💰",
  "Revenue & Growth": "📈",
  "Operational Margin": "⚙️",
  "Macro & Risk": "🌐",
};

function StatusIcon({ status }: { status: AgentStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />;
    case "running":
      return <Loader2 size={13} className="text-brand-500 animate-spin shrink-0" />;
    case "error":
      return <XCircle size={13} className="text-red-400 shrink-0" />;
    default:
      return <Circle size={13} className="text-gray-250 shrink-0" />;
  }
}

function StatusRow({ label, status }: { label: string; status: AgentStatus }) {
  return (
    <div className="flex items-center gap-2">
      <StatusIcon status={status} />
      <span
        className={clsx(
          "text-xs leading-none",
          status === "done"
            ? "text-gray-500"
            : status === "running"
            ? "text-gray-800 font-medium"
            : "text-gray-350"
        )}
      >
        {label}
      </span>
    </div>
  );
}

interface AgentPanelProps {
  state: AgentPanelState;
  ticker: string;
  qPrev: string;
  qCurr: string;
}

export default function AgentPanel({ state, ticker, qPrev, qCurr }: AgentPanelProps) {
  const phaseLabel: Record<AgentPanelState["phase"], string> = {
    idle: "Starting…",
    extracting: "Extracting PDF text…",
    thematic: "Running thematic agents in parallel…",
    delta: "Computing quarter-over-quarter deltas…",
    finalizing: "Fetching market data & finalising…",
  };

  const allThematicDone = state.sections.every(
    (s) => state.prevStatus[s] === "done" && state.currStatus[s] === "done"
  );
  const allDeltaDone = state.sections.every((s) => state.deltaStatus[s] === "done");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Multi-Agent Analysis</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {ticker} · {quarterLabel(qPrev)} → {quarterLabel(qCurr)}
          </p>
        </div>
        <span className="text-xs text-brand-500 animate-pulse font-medium">
          {phaseLabel[state.phase]}
        </span>
      </div>

      {/* 4 thematic agent cards */}
      <div className="grid grid-cols-2 gap-3">
        {state.sections.map((section) => {
          const prevDone = state.prevStatus[section] === "done";
          const currDone = state.currStatus[section] === "done";
          const deltaActive = prevDone && currDone;

          return (
            <div
              key={section}
              className={clsx(
                "rounded-xl border bg-white p-4 space-y-3 transition-all",
                state.deltaStatus[section] === "done"
                  ? "border-emerald-200 shadow-sm"
                  : "border-gray-200"
              )}
            >
              {/* Card header */}
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">
                  {SECTION_ICONS[section] ?? "🔍"}
                </span>
                <span className="text-xs font-semibold text-gray-800 leading-tight">
                  {section}
                </span>
                {state.deltaStatus[section] === "done" && (
                  <CheckCircle2 size={12} className="text-emerald-500 ml-auto shrink-0" />
                )}
              </div>

              {/* Status rows */}
              <div className="space-y-2">
                <StatusRow
                  label={`${quarterLabel(qPrev)} read`}
                  status={state.prevStatus[section] ?? "idle"}
                />
                <StatusRow
                  label={`${quarterLabel(qCurr)} read`}
                  status={state.currStatus[section] ?? "idle"}
                />
                <div className={clsx("pt-1 border-t border-gray-100", !deltaActive && "opacity-40")}>
                  <StatusRow
                    label="QoQ delta analysis"
                    status={deltaActive ? (state.deltaStatus[section] ?? "running") : "idle"}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom bar: evasiveness + stock */}
      <div className="grid grid-cols-2 gap-3">
        {/* Evasiveness agent */}
        <div
          className={clsx(
            "rounded-xl border bg-white px-4 py-3 flex items-center justify-between transition-all",
            state.evasivenessStatus === "done" ? "border-emerald-200" : "border-gray-200"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">🎭</span>
            <StatusIcon status={state.evasivenessStatus} />
            <span className="text-xs font-semibold text-gray-800">Evasiveness Agent</span>
          </div>
          {state.evasivenessScore !== null && (
            <span className="text-xs text-gray-500 font-mono">
              {state.evasivenessScore.toFixed(1)}/10
            </span>
          )}
        </div>

        {/* Stock price agent */}
        <div
          className={clsx(
            "rounded-xl border bg-white px-4 py-3 flex items-center justify-between transition-all",
            state.stockStatus === "done" ? "border-emerald-200" : "border-gray-200",
            !allDeltaDone && "opacity-40"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">📊</span>
            <StatusIcon status={allDeltaDone ? state.stockStatus : "idle"} />
            <span className="text-xs font-semibold text-gray-800">Market Data</span>
          </div>
          {state.stockChange !== null && (
            <span
              className={clsx(
                "text-xs font-mono font-medium",
                state.stockChange > 0 ? "text-emerald-600" : state.stockChange < 0 ? "text-red-500" : "text-gray-400"
              )}
            >
              {state.stockChange === 0
                ? "—"
                : `${state.stockChange > 0 ? "+" : ""}${state.stockChange.toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
