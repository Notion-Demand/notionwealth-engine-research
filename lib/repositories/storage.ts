import { supabaseAdmin } from "@/lib/supabase/admin";
import { BlobServiceClient, BlobSASPermissions } from "@azure/storage-blob";

const BUCKET = "transcripts";

export interface TranscriptFile {
  name: string;
}

export interface ListOptions {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: { column: string; order: "asc" | "desc" };
}

export interface StorageRepository {
  list(options: ListOptions): Promise<TranscriptFile[]>;
  /** Wraps the while(true)-paginated "list every file, 100 at a time" pattern used across several call sites. */
  listAllPaginated(pageSize?: number): Promise<TranscriptFile[]>;
  download(path: string): Promise<Buffer>;
  upload(path: string, data: Buffer): Promise<void>;
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export class SupabaseStorageRepository implements StorageRepository {
  async list(options: ListOptions): Promise<TranscriptFile[]> {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).list("", options);
    if (error) throw new Error(`Storage list failed: ${error.message}`);
    return data ?? [];
  }

  async listAllPaginated(pageSize = 100): Promise<TranscriptFile[]> {
    // Increments offset by the actual page length and stops only on a truly
    // empty page — NOT on a short page. Supabase Storage's list() can return
    // fewer than `limit` items even when more exist; every one of the 5
    // original call sites this repository consolidates already handled this
    // correctly, and this must keep doing so.
    const all: TranscriptFile[] = [];
    let offset = 0;
    while (true) {
      const { data: page, error } = await supabaseAdmin().storage.from(BUCKET).list("", { limit: pageSize, offset });
      if (error) throw new Error(`Storage list failed: ${error.message}`);
      if (!page || page.length === 0) break;
      all.push(...page);
      offset += page.length;
    }
    return all;
  }

  async download(path: string): Promise<Buffer> {
    const { data: blob, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
    if (error || !blob) throw new Error(`Storage download failed for ${path}: ${error?.message}`);
    return Buffer.from(await blob.arrayBuffer());
  }

  async upload(path: string, data: Buffer): Promise<void> {
    const { error } = await supabaseAdmin()
      .storage.from(BUCKET)
      .upload(path, data, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`Signed URL failed for ${path}: ${error?.message}`);
    return data.signedUrl;
  }
}

const AZURE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "transcripts";

let _blobServiceClient: BlobServiceClient | null = null;
function blobServiceClient(): BlobServiceClient {
  if (!_blobServiceClient) {
    _blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!);
  }
  return _blobServiceClient;
}

// Azure Blob's listBlobsFlat() has no server-side substring search, so every
// list()/listAllPaginated() call used to walk the entire container — with
// ~200 parallel per-ticker searches on one page load (app/api/v1/available),
// that meant ~200 full-container enumerations per request. Transcript uploads
// are rare, so a short-lived cache of the full listing turns that into at most
// one real Azure call per TTL window, shared across all concurrent callers.
const LIST_CACHE_TTL_MS = 60_000;
let _listCache: { blobs: TranscriptFile[]; expiresAt: number } | null = null;

export class AzureBlobStorageRepository implements StorageRepository {
  private async allBlobs(): Promise<TranscriptFile[]> {
    if (_listCache && _listCache.expiresAt > Date.now()) return _listCache.blobs;
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const blobs: TranscriptFile[] = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push({ name: blob.name });
    }
    _listCache = { blobs, expiresAt: Date.now() + LIST_CACHE_TTL_MS };
    return blobs;
  }

  async list(options: ListOptions): Promise<TranscriptFile[]> {
    const all = await this.allBlobs();
    const results = options.search
      ? all.filter((blob) => blob.name.toLowerCase().includes(options.search!.toLowerCase()))
      : all;
    let sorted = results;
    if (options.sortBy) {
      const { column, order } = options.sortBy;
      sorted = [...results].sort((a, b) => {
        const cmp = column === "name" ? a.name.localeCompare(b.name) : 0;
        return order === "asc" ? cmp : -cmp;
      });
    }
    const offset = options.offset ?? 0;
    const limit = options.limit;
    return limit !== undefined ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
  }

  async listAllPaginated(): Promise<TranscriptFile[]> {
    return this.allBlobs();
  }

  async download(path: string): Promise<Buffer> {
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const blobClient = containerClient.getBlobClient(path);
    const downloadResponse = await blobClient.download();
    if (!downloadResponse.readableStreamBody) {
      throw new Error(`Storage download failed for ${path}: empty response body`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async upload(path: string, data: Buffer): Promise<void> {
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const blockBlobClient = containerClient.getBlockBlobClient(path);
    await blockBlobClient.upload(data, data.length, {
      blobHTTPHeaders: { blobContentType: "application/pdf" },
    });
    _listCache = null;
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const containerClient = blobServiceClient().getContainerClient(AZURE_CONTAINER);
    const blobClient = containerClient.getBlobClient(path);
    const expiresOn = new Date(Date.now() + expiresInSeconds * 1000);
    return blobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    });
  }
}
