-- Cache for YouTube concall video lookups.
-- Populated on-demand; avoids re-hitting the YouTube Data API for the same
-- ticker+quarter pair. One row per company per quarter.
CREATE TABLE IF NOT EXISTS concall_links (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker        TEXT    NOT NULL,
  quarter       TEXT    NOT NULL,              -- e.g. "Q4_2026"
  youtube_url   TEXT    NOT NULL,              -- watch URL or search URL
  video_id      TEXT,                          -- null when only a search fallback
  video_title   TEXT,
  channel_title TEXT,
  fetched_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ticker, quarter)
);

CREATE INDEX IF NOT EXISTS idx_cl_ticker  ON concall_links(ticker);
CREATE INDEX IF NOT EXISTS idx_cl_quarter ON concall_links(quarter);
