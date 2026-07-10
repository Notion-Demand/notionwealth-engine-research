import { supabaseAdmin } from "@/lib/supabase/admin";

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
