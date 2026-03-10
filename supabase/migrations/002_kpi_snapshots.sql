-- kpi_snapshots: cached quarterly KPI extractions per company
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_ticker TEXT NOT NULL,
  quarter TEXT NOT NULL,
  quarter_previous TEXT NOT NULL,
  sector TEXT,
  kpis JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint per company + quarter pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_ticker_quarter
  ON kpi_snapshots(company_ticker, quarter);

-- No RLS needed — this is server-side only cached data
