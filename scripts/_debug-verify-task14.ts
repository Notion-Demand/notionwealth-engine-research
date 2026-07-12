import { createHash } from "node:crypto";
import { PostgresApiAccessRepository } from "@/lib/repositories/apiAccess";

async function main() {
  const repo = new PostgresApiAccessRepository();
  const { id: partnerId } = await repo.createPartner("Test Partner");
  const keyHash = createHash("sha256").update("test-key").digest("hex");
  const { id: keyId } = await repo.createKey(partnerId, keyHash, 1000);
  await repo.grantEntitlement(keyId, "data:companies");
  const info = await repo.getKeyByHash(keyHash);
  console.log("key info:", info);
  const windowStart = new Date().toISOString().slice(0, 10);
  await repo.incrementUsage(keyId, windowStart);
  await repo.incrementUsage(keyId, windowStart);
  const usage = await repo.getUsageToday(keyId, windowStart);
  console.log("usage after 2 increments:", usage, "(expected: 2)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
