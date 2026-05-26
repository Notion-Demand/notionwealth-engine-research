-- Earnings calendar: one row per company per quarter, enriched from multiple sources.
-- source hierarchy: tickertape > bse_notice > screener > estimated | transcript
CREATE TABLE IF NOT EXISTS earnings_calendar (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker      TEXT    NOT NULL,
  date        DATE    NOT NULL,
  quarter     TEXT    NOT NULL,            -- e.g. "Q4_2026"
  source      TEXT    NOT NULL DEFAULT 'estimated',
  confirmed   BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE once transcript is in storage
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ticker, quarter)
);

CREATE INDEX IF NOT EXISTS idx_ec_date   ON earnings_calendar(date);
CREATE INDEX IF NOT EXISTS idx_ec_ticker ON earnings_calendar(ticker);
