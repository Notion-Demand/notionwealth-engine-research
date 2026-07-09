-- Public API access: partners, keys, per-key entitlements, and daily usage.
-- No RLS — accessed only via supabaseAdmin() service-role client from
-- middleware and the internal provisioning script, same as user_credits.

CREATE TABLE IF NOT EXISTS api_partners (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id   UUID        NOT NULL REFERENCES api_partners(id) ON DELETE CASCADE,
  key_hash     TEXT        NOT NULL UNIQUE,
  active       BOOLEAN     NOT NULL DEFAULT true,
  daily_quota  INTEGER     NOT NULL DEFAULT 1000,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS api_key_products (
  key_id       UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  PRIMARY KEY (key_id, product_name)
);

CREATE TABLE IF NOT EXISTS api_usage (
  key_id        UUID    NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start  DATE    NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);
