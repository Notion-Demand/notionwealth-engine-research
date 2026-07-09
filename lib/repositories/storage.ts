import { supabaseAdmin } from "@/lib/supabase/admin";

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
