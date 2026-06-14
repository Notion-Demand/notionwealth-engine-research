-- Promoter/insider disclosures pulled from BSE's "Insider Trading / SAST" feed
-- (AnnSubCategoryGetData/w, strCat="Insider Trading / SAST"). Powers the
-- promoter pledge-activity signal on the Portfolio Watchtower.
CREATE TABLE IF NOT EXISTS promoter_activity (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker          TEXT NOT NULL,
  news_id         TEXT NOT NULL,           -- BSE NEWSID, used for de-dup
  disclosure_date DATE NOT NULL,
  subcat_name     TEXT NOT NULL,
  headline        TEXT NOT NULL,
  attachment_name TEXT,
  event_type      TEXT NOT NULL,           -- 'pledge' | 'institutional' | 'other'
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ticker, news_id)
);

CREATE INDEX IF NOT EXISTS idx_promoter_activity_ticker_date
  ON promoter_activity(ticker, disclosure_date DESC);

-- Tracks the last successful BSE fetch per ticker so the API can decide
-- whether to re-fetch, even for tickers with zero matching disclosures.
CREATE TABLE IF NOT EXISTS promoter_activity_fetch_log (
  ticker     TEXT PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count  INT NOT NULL DEFAULT 0
);

-- Service-role only — no RLS needed (accessed via supabaseAdmin)
