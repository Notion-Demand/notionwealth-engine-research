import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";

export interface ApiKeyInfo {
  keyId: string;
  partnerId: string;
  partnerName: string;
  active: boolean;
  dailyQuota: number;
  entitledProducts: string[];
}

export interface ApiAccessRepository {
  getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null>;
  getUsageToday(keyId: string, windowStart: string): Promise<number>;
  incrementUsage(keyId: string, windowStart: string): Promise<void>;
  createPartner(name: string): Promise<{ id: string }>;
  createKey(partnerId: string, keyHash: string, dailyQuota: number): Promise<{ id: string }>;
  grantEntitlement(keyId: string, productName: string): Promise<void>;
}

interface StoredKeyRow {
  id: string;
  partner_id: string;
  active: boolean;
  daily_quota: number;
  api_partners: { name: string } | null;
  api_key_products: { product_name: string }[];
}

export class SupabaseApiAccessRepository implements ApiAccessRepository {
  async getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null> {
    const { data, error } = await supabaseAdmin()
      .from("api_keys")
      .select("id, partner_id, active, daily_quota, api_partners(name), api_key_products(product_name)")
      .eq("key_hash", keyHash)
      .maybeSingle();
    if (error) throw new Error(`getKeyByHash failed: ${error.message}`);
    if (!data) return null;
    const row = data as unknown as StoredKeyRow;
    return {
      keyId: row.id,
      partnerId: row.partner_id,
      partnerName: row.api_partners?.name ?? "",
      active: row.active,
      dailyQuota: row.daily_quota,
      entitledProducts: row.api_key_products.map((p) => p.product_name),
    };
  }

  async getUsageToday(keyId: string, windowStart: string): Promise<number> {
    const { data } = await supabaseAdmin()
      .from("api_usage")
      .select("request_count")
      .eq("key_id", keyId)
      .eq("window_start", windowStart)
      .maybeSingle();
    return data?.request_count ?? 0;
  }

  async incrementUsage(keyId: string, windowStart: string): Promise<void> {
    const current = await this.getUsageToday(keyId, windowStart);
    await supabaseAdmin()
      .from("api_usage")
      .upsert(
        { key_id: keyId, window_start: windowStart, request_count: current + 1 },
        { onConflict: "key_id,window_start" }
      );
  }

  async createPartner(name: string): Promise<{ id: string }> {
    const { data, error } = await supabaseAdmin()
      .from("api_partners")
      .insert({ name })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createPartner failed: ${error?.message}`);
    return { id: data.id };
  }

  async createKey(partnerId: string, keyHash: string, dailyQuota: number): Promise<{ id: string }> {
    const { data, error } = await supabaseAdmin()
      .from("api_keys")
      .insert({ partner_id: partnerId, key_hash: keyHash, daily_quota: dailyQuota })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createKey failed: ${error?.message}`);
    return { id: data.id };
  }

  async grantEntitlement(keyId: string, productName: string): Promise<void> {
    const { error } = await supabaseAdmin()
      .from("api_key_products")
      .upsert({ key_id: keyId, product_name: productName }, { onConflict: "key_id,product_name" });
    if (error) throw new Error(`grantEntitlement failed: ${error.message}`);
  }
}

export class PostgresApiAccessRepository implements ApiAccessRepository {
  async getKeyByHash(keyHash: string): Promise<ApiKeyInfo | null> {
    const rows = await query<{
      id: string; partner_id: string; active: boolean; daily_quota: number;
      partner_name: string | null; entitled_products: string[];
    }>(
      `SELECT ak.id, ak.partner_id, ak.active, ak.daily_quota, ap.name AS partner_name,
              COALESCE(array_agg(akp.product_name) FILTER (WHERE akp.product_name IS NOT NULL), '{}') AS entitled_products
       FROM api_keys ak
       LEFT JOIN api_partners ap ON ap.id = ak.partner_id
       LEFT JOIN api_key_products akp ON akp.key_id = ak.id
       WHERE ak.key_hash = $1
       GROUP BY ak.id, ap.name`,
      [keyHash]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      keyId: row.id,
      partnerId: row.partner_id,
      partnerName: row.partner_name ?? "",
      active: row.active,
      dailyQuota: row.daily_quota,
      entitledProducts: row.entitled_products,
    };
  }

  async getUsageToday(keyId: string, windowStart: string): Promise<number> {
    const rows = await query<{ request_count: number }>(
      `SELECT request_count FROM api_usage WHERE key_id = $1 AND window_start = $2`,
      [keyId, windowStart]
    );
    return rows.length > 0 ? rows[0].request_count : 0;
  }

  /** Atomic, unlike the Supabase version's non-atomic read-then-write — a
   *  deliberate, confirmed improvement made possible by writing raw SQL by
   *  hand for this migration (see Global Constraints). */
  async incrementUsage(keyId: string, windowStart: string): Promise<void> {
    await query(
      `INSERT INTO api_usage (key_id, window_start, request_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (key_id, window_start) DO UPDATE SET request_count = api_usage.request_count + 1`,
      [keyId, windowStart]
    );
  }

  async createPartner(name: string): Promise<{ id: string }> {
    const rows = await query<{ id: string }>(`INSERT INTO api_partners (name) VALUES ($1) RETURNING id`, [name]);
    if (rows.length === 0) throw new Error("createPartner failed: no row returned");
    return { id: rows[0].id };
  }

  async createKey(partnerId: string, keyHash: string, dailyQuota: number): Promise<{ id: string }> {
    const rows = await query<{ id: string }>(
      `INSERT INTO api_keys (partner_id, key_hash, daily_quota) VALUES ($1, $2, $3) RETURNING id`,
      [partnerId, keyHash, dailyQuota]
    );
    if (rows.length === 0) throw new Error("createKey failed: no row returned");
    return { id: rows[0].id };
  }

  async grantEntitlement(keyId: string, productName: string): Promise<void> {
    await query(
      `INSERT INTO api_key_products (key_id, product_name) VALUES ($1, $2)
       ON CONFLICT (key_id, product_name) DO NOTHING`,
      [keyId, productName]
    );
  }
}
