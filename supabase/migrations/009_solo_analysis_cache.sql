-- Cache for single-quarter deep-dive analysis payloads.
-- Keyed by (ticker, quarter). One comprehensive analysis per company per quarter.
CREATE TABLE IF NOT EXISTS solo_analysis_cache (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker     TEXT        NOT NULL,
  quarter    TEXT        NOT NULL,
  payload    JSONB       NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ticker, quarter)
);

-- Service-role only — no RLS needed (accessed via supabaseAdmin)
