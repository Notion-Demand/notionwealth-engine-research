import { pgPool } from "@/lib/postgres/client";

async function main() {
  await pgPool().query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  console.log("Schema reset complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Schema reset failed:", err);
    process.exit(1);
  });
