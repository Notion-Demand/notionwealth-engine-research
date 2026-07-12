import { createClient } from "@supabase/supabase-js";
import { BlobServiceClient } from "@azure/storage-blob";
import { storageRepo } from "@/lib/repositories";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING!;
const AZURE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "transcripts";
const BUCKET = "transcripts";

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
  const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER);

  // Reuses the existing StorageRepository.listAllPaginated() for enumeration
  // (its empty-page-not-short-page pagination logic is already correct and
  // battle-tested) — only the actual per-file copy bypasses the repository
  // interface, since that's the one place streaming matters.
  const files = await storageRepo.listAllPaginated();
  console.log(`Found ${files.length} files to copy.`);

  let copied = 0;
  for (const file of files) {
    const { data: downloadData, error: downloadError } = await supabase.storage.from(BUCKET).download(file.name);
    if (downloadError || !downloadData) {
      console.error(`FAILED to download ${file.name}: ${downloadError?.message}`);
      continue;
    }
    const stream = downloadData.stream() as unknown as NodeJS.ReadableStream;
    const blockBlobClient = containerClient.getBlockBlobClient(file.name);
    await blockBlobClient.uploadStream(stream as any, undefined, undefined, {
      blobHTTPHeaders: { blobContentType: "application/pdf" },
    });
    copied++;
    if (copied % 10 === 0) console.log(`Copied ${copied}/${files.length}...`);
  }

  console.log(`Blob migration complete: ${copied}/${files.length} copied.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Blob migration failed:", err);
    process.exit(1);
  });
