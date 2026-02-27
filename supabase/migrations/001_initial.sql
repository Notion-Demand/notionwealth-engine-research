-- ============================================================
-- 001_initial.sql — NotionWealth Intelligence Engine schema
-- ============================================================

-- user_connections: one row per provider per user
CREATE TABLE IF NOT EXISTS user_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('gmail', 'slack')),

  -- Gmail fields
  gmail_email         TEXT,
  gmail_access_token  TEXT,
  gmail_refresh_token TEXT,
  gmail_token_expiry  TIMESTAMPTZ,

  -- Slack fields
  slack_team_id       TEXT,
  slack_team_name     TEXT,
  slack_bot_token     TEXT,

  connected_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, provider)
);

-- RLS: each user sees only their own rows
ALTER TABLE user_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows" ON user_connections
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- analysis_results: cached per-user analysis payloads
CREATE TABLE IF NOT EXISTS analysis_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_ticker  TEXT NOT NULL,
  q_prev          TEXT NOT NULL,
  q_curr          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows" ON analysis_results
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- auto-update updated_at on user_connections
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_connections_updated_at
  BEFORE UPDATE ON user_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
