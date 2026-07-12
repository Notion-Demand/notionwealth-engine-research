import { PostgresCalendarRepository } from "@/lib/repositories/calendar";
import { PostgresConcallRepository } from "@/lib/repositories/concalls";

async function main() {
  console.log("--- Task 12: PostgresCalendarRepository ---");
  const calendarRepo = new PostgresCalendarRepository();
  const upserted = await calendarRepo.upsertEvents([
    { ticker: "TESTCO", date: "2026-07-15", quarter: "Q4_2026", source: "estimated", confirmed: false, updatedAt: new Date().toISOString() },
  ]);
  console.log("upserted:", upserted);
  const listed = await calendarRepo.listInRange("2026-07-01", "2026-07-31");
  console.log("events in range:", listed.events.length);

  console.log("--- Task 13: PostgresConcallRepository ---");
  const concallRepo = new PostgresConcallRepository();
  await concallRepo.saveLink({ ticker: "TESTCO", quarter: "Q4_2026", youtubeUrl: "https://youtube.com/watch?v=abc", videoId: "abc", videoTitle: "Test Concall", channelTitle: "Test Channel", fetchedAt: "" });
  const cached = await concallRepo.getCached("TESTCO", "Q4_2026");
  console.log("cached:", cached);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
