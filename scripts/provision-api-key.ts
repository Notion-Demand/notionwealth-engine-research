import { randomBytes, createHash } from "node:crypto";
import { apiAccessRepo } from "@/lib/repositories";

function generateRawKey(): string {
  return "qzk_live_" + randomBytes(24).toString("base64url");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function main() {
  const [, , partnerName, dailyQuotaArg, ...products] = process.argv;
  if (!partnerName || !dailyQuotaArg || products.length === 0) {
    console.error(
      "Usage: npx tsx scripts/provision-api-key.ts \"<partner name>\" <daily-quota> <product-name> [product-name ...]"
    );
    console.error(
      "Example: npx tsx scripts/provision-api-key.ts \"Acme PMS\" 1000 data:companies data:sectors products:sector-thesis"
    );
    process.exit(1);
  }

  const dailyQuota = Number(dailyQuotaArg);
  if (!Number.isInteger(dailyQuota) || dailyQuota <= 0) {
    console.error(`Invalid daily quota: ${dailyQuotaArg}`);
    process.exit(1);
  }

  const { id: partnerId } = await apiAccessRepo.createPartner(partnerName);
  const rawKey = generateRawKey();
  const keyHash = sha256Hex(rawKey);
  const { id: keyId } = await apiAccessRepo.createKey(partnerId, keyHash, dailyQuota);

  for (const product of products) {
    await apiAccessRepo.grantEntitlement(keyId, product);
  }

  console.log(`Partner created: ${partnerName} (${partnerId})`);
  console.log(`Key ID: ${keyId}`);
  console.log(`Daily quota: ${dailyQuota}`);
  console.log(`Entitled products: ${products.join(", ")}`);
  console.log("");
  console.log("Raw API key (shown once, not recoverable — store it now):");
  console.log(rawKey);
  console.log("");
  console.log("Example request:");
  console.log(
    `curl -H "Authorization: Bearer ${rawKey}" "http://localhost:3000/api/public/v1/data/companies/RELIANCE"`
  );
}

main().catch((err) => {
  console.error("Provisioning failed:", err);
  process.exit(1);
});
