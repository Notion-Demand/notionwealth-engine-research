/**
 * Repository for evidence_verifications (supabase/migrations/012_rag_and_agents.sql)
 * — persistence for lib/agents/evidenceVerification.ts's output. This is
 * Quantalyze's first genuine "intelligence object" table: a first-class,
 * queryable record of something an agent concluded, with its evidence and
 * provenance kept alongside it, not just a generated paragraph.
 */
import { query } from "@/lib/postgres/client";
import type { EvidenceVerificationResult } from "@/lib/agents/evidenceVerification";

export interface EvidenceVerificationRepository {
  save(result: EvidenceVerificationResult): Promise<string>;
  getLatestByTicker(ticker: string): Promise<EvidenceVerificationResult | null>;
}

interface Row {
  ticker: string;
  quarter: string;
  quarter_previous: string;
  status: string;
  findings: unknown;
  supported_count: number;
  unsupported_count: number;
  uncertain_count: number;
  model: string;
  agent_version: string;
  created_at: string;
}

function toResult(row: Row): EvidenceVerificationResult {
  return {
    ticker: row.ticker,
    quarter: row.quarter,
    quarterPrevious: row.quarter_previous,
    status: row.status as EvidenceVerificationResult["status"],
    // pg parses JSONB into a JS value automatically on read — see
    // lib/postgres/client.ts's query() doc comment.
    findings: row.findings as EvidenceVerificationResult["findings"],
    supportedCount: row.supported_count,
    unsupportedCount: row.unsupported_count,
    uncertainCount: row.uncertain_count,
    model: row.model,
    agentVersion: row.agent_version,
    createdAt: row.created_at,
  };
}

export class PostgresEvidenceVerificationRepository implements EvidenceVerificationRepository {
  async save(result: EvidenceVerificationResult): Promise<string> {
    const rows = await query<{ id: string }>(
      `INSERT INTO evidence_verifications
         (ticker, quarter, quarter_previous, status, findings, supported_count, unsupported_count, uncertain_count, model, agent_version)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        result.ticker,
        result.quarter,
        result.quarterPrevious,
        result.status,
        JSON.stringify(result.findings),
        result.supportedCount,
        result.unsupportedCount,
        result.uncertainCount,
        result.model,
        result.agentVersion,
      ]
    );
    if (rows.length === 0) throw new Error("evidence_verifications insert returned no row");
    return rows[0].id;
  }

  async getLatestByTicker(ticker: string): Promise<EvidenceVerificationResult | null> {
    const rows = await query<Row>(
      `SELECT ticker, quarter, quarter_previous, status, findings, supported_count, unsupported_count, uncertain_count, model, agent_version, created_at
       FROM evidence_verifications
       WHERE ticker = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [ticker]
    );
    return rows.length > 0 ? toResult(rows[0]) : null;
  }
}
