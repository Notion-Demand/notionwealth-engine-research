-- Cache for multi-quarter insights payloads.
-- Keyed by (ticker, quarters_key) where quarters_key is the sorted, comma-joined
-- list of quarters that were analyzed (e.g. "Q1_2026,Q2_2026,Q3_2026,Q4_2026").
-- A new quarter being uploaded changes the quarters_key → automatic cache invalidation.
-- Entries expire after 30 days (enforced in application layer).
CREATE TABLE IF NOT EXISTS insights_cache (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker       TEXT    NOT NULL,
  quarters_key TEXT    NOT NULL,   -- sorted, comma-separated quarter list
  payload      JSONB   NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ticker, quarters_key)
);

-- Service-role only — no RLS needed (accessed via supabaseAdmin)
