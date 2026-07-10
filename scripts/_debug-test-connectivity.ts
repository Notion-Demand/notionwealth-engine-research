import { Client } from "pg";

async function main() {
  const client = new Client({
    connectionString: process.env.POSTGRES_CONNECTION_STRING,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  const result = await client.query("SELECT version()");
  console.log("CONNECTED:", result.rows[0].version);
  await client.end();
}

main().catch((err) => {
  console.error("CONNECTION FAILED:", err.message);
  process.exit(1);
});
