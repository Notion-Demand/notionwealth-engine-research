import { AzureBlobStorageRepository } from "@/lib/repositories/storage";

async function main() {
  const repo = new AzureBlobStorageRepository();
  const testData = Buffer.from("%PDF-1.4 test content");
  await repo.upload("test/hello.pdf", testData);
  const downloaded = await repo.download("test/hello.pdf");
  console.log("round-trip matches:", downloaded.equals(testData));
  const listed = await repo.list({ search: "hello" });
  console.log("listed:", listed);
  const url = await repo.createSignedUrl("test/hello.pdf", 60);
  console.log("signed url starts with https:", url.startsWith("https://"));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exit(1);
  });
