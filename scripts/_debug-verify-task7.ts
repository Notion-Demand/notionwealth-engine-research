import { PostgresWatchlistRepository } from "@/lib/repositories/watchlist";

async function main() {
  const repo = new PostgresWatchlistRepository();
  const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
  const added = await repo.add(TEST_USER_ID, "TESTCO", "Test Co", "Custom");
  console.log("added:", added);
  const listed = await repo.list(TEST_USER_ID);
  console.log("listed count:", listed.tickers.length);
  const otherUserListed = await repo.list("00000000-0000-0000-0000-000000000002");
  console.log("other user sees:", otherUserListed.tickers.length, "(expected: 0 — confirms WHERE user_id filtering works)");
  await repo.remove(TEST_USER_ID, "TESTCO");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
