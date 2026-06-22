-- User credits: tracks monthly usage quota.
-- 1 credit = $0.01. Default monthly allowance = 600 credits ($6).
-- Resets each calendar month.
CREATE TABLE IF NOT EXISTS user_credits (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month      TEXT        NOT NULL,  -- 'YYYY-MM'
  used       INTEGER     NOT NULL DEFAULT 0,
  quota      INTEGER     NOT NULL DEFAULT 600,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, month)
);

-- Service-role access (no RLS — managed by backend)
