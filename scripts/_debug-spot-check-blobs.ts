import { createClient } from "@supabase/supabase-js";
import { AzureBlobStorageRepository } from "@/lib/repositories/storage";

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const azureRepo = new AzureBlobStorageRepository();
  const azureFiles = await azureRepo.listAllPaginated();
  console.log("Azure file count:", azureFiles.length);

  const sample = azureFiles.slice(0, 3);
  for (const file of sample) {
    const { data, error } = await supabase.storage.from("transcripts").download(file.name);
    if (error || !data) {
      console.log(`${file.name}: FAILED to download from Supabase for comparison`);
      continue;
    }
    const supabaseBuf = Buffer.from(await data.arrayBuffer());
    const azureBuf = await azureRepo.download(file.name);
    console.log(`${file.name}: Supabase=${supabaseBuf.length}B Azure=${azureBuf.length}B match=${supabaseBuf.equals(azureBuf)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Spot check failed:", err);
    process.exit(1);
  });
