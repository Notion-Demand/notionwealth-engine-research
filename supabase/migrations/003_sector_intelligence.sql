-- Sector Intelligence cache: stores Gemini-synthesized sector-level insights
CREATE TABLE IF NOT EXISTS sector_intelligence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sector TEXT NOT NULL,
  quarter TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sector, quarter)
);
