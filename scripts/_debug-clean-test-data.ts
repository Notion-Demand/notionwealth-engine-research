import { pgPool } from "@/lib/postgres/client";

const TEST_USER_IDS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];

async function main() {
  const pool = pgPool();
  await pool.query(`DELETE FROM analysis_results WHERE company_ticker = 'TESTCO'`);
  await pool.query(`DELETE FROM sector_intelligence WHERE sector = 'TestSector'`);
  await pool.query(`DELETE FROM kpi_snapshots WHERE company_ticker = 'TESTCO'`);
  await pool.query(`DELETE FROM user_tickers WHERE user_id = ANY($1::uuid[])`, [TEST_USER_IDS]);
  await pool.query(`DELETE FROM user_credits WHERE user_id = ANY($1::uuid[])`, [TEST_USER_IDS]);
  await pool.query(`DELETE FROM solo_analysis_cache WHERE ticker = 'Test Company'`);
  await pool.query(`DELETE FROM insights_cache WHERE ticker = 'TESTCO'`);
  await pool.query(`DELETE FROM promoter_activity WHERE ticker = 'TESTCO'`);
  await pool.query(`DELETE FROM promoter_activity_fetch_log WHERE ticker = 'TESTCO'`);
  await pool.query(`DELETE FROM earnings_calendar WHERE ticker = 'TESTCO'`);
  await pool.query(`DELETE FROM concall_links WHERE ticker = 'TESTCO'`);
  await pool.query(`DELETE FROM api_key_products WHERE key_id IN (SELECT id FROM api_keys WHERE partner_id IN (SELECT id FROM api_partners WHERE name = 'Test Partner'))`);
  await pool.query(`DELETE FROM api_usage WHERE key_id IN (SELECT id FROM api_keys WHERE partner_id IN (SELECT id FROM api_partners WHERE name = 'Test Partner'))`);
  await pool.query(`DELETE FROM api_keys WHERE partner_id IN (SELECT id FROM api_partners WHERE name = 'Test Partner')`);
  await pool.query(`DELETE FROM api_partners WHERE name = 'Test Partner'`);

  const counts = await pool.query<{ table_name: string; count: string }>(`
    SELECT 'analysis_results' AS table_name, count(*)::text FROM analysis_results
    UNION ALL SELECT 'sector_intelligence', count(*)::text FROM sector_intelligence
    UNION ALL SELECT 'kpi_snapshots', count(*)::text FROM kpi_snapshots
    UNION ALL SELECT 'user_tickers', count(*)::text FROM user_tickers
    UNION ALL SELECT 'user_credits', count(*)::text FROM user_credits
    UNION ALL SELECT 'solo_analysis_cache', count(*)::text FROM solo_analysis_cache
    UNION ALL SELECT 'insights_cache', count(*)::text FROM insights_cache
    UNION ALL SELECT 'promoter_activity', count(*)::text FROM promoter_activity
    UNION ALL SELECT 'promoter_activity_fetch_log', count(*)::text FROM promoter_activity_fetch_log
    UNION ALL SELECT 'earnings_calendar', count(*)::text FROM earnings_calendar
    UNION ALL SELECT 'concall_links', count(*)::text FROM concall_links
    UNION ALL SELECT 'api_partners', count(*)::text FROM api_partners
    UNION ALL SELECT 'api_keys', count(*)::text FROM api_keys
    UNION ALL SELECT 'api_key_products', count(*)::text FROM api_key_products
    UNION ALL SELECT 'api_usage', count(*)::text FROM api_usage
  `);
  console.log("Row counts after cleanup (all should be 0):");
  for (const row of counts.rows) console.log(`  ${row.table_name}: ${row.count}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
