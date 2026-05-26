-- Personal ticker list: stocks outside Nifty 200 that a user has added.
-- Row-level security ensures each user can only see and manage their own rows.
CREATE TABLE IF NOT EXISTS user_tickers (
  id        UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker    TEXT    NOT NULL,
  name      TEXT    NOT NULL DEFAULT '',   -- display name (ticker if unknown)
  sector    TEXT    NOT NULL DEFAULT 'Custom',
  added_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ticker)
);

ALTER TABLE user_tickers ENABLE ROW LEVEL SECURITY;

-- Users can only read / write their own rows
CREATE POLICY "user_tickers_self"
  ON user_tickers
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
