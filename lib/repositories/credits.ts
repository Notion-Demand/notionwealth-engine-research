import { supabaseAdmin } from "@/lib/supabase/admin";
import { query } from "@/lib/postgres/client";

export interface CreditStatus {
  used: number;
  quota: number;
  remaining: number;
  month: string;
}

export interface CreditsRepository {
  getOrCreateStatus(userId: string, month: string, defaultQuota: number): Promise<CreditStatus>;
  setUsed(userId: string, month: string, used: number): Promise<void>;
}

export class SupabaseCreditsRepository implements CreditsRepository {
  async getOrCreateStatus(userId: string, month: string, defaultQuota: number): Promise<CreditStatus> {
    const { data } = await supabaseAdmin()
      .from("user_credits")
      .select("used, quota")
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle();

    if (data) {
      return { used: data.used, quota: data.quota, remaining: data.quota - data.used, month };
    }

    await supabaseAdmin()
      .from("user_credits")
      .upsert({ user_id: userId, month, used: 0, quota: defaultQuota }, { onConflict: "user_id,month" });

    return { used: 0, quota: defaultQuota, remaining: defaultQuota, month };
  }

  async setUsed(userId: string, month: string, used: number): Promise<void> {
    await supabaseAdmin().from("user_credits").update({ used }).eq("user_id", userId).eq("month", month);
  }
}

export class PostgresCreditsRepository implements CreditsRepository {
  async getOrCreateStatus(userId: string, month: string, defaultQuota: number): Promise<CreditStatus> {
    const existing = await query<{ used: number; quota: number }>(
      `SELECT used, quota FROM user_credits WHERE user_id = $1 AND month = $2`,
      [userId, month]
    );
    if (existing.length > 0) {
      const { used, quota } = existing[0];
      return { used, quota, remaining: quota - used, month };
    }
    await query(
      `INSERT INTO user_credits (user_id, month, used, quota) VALUES ($1, $2, 0, $3)
       ON CONFLICT (user_id, month) DO UPDATE SET used = EXCLUDED.used, quota = EXCLUDED.quota`,
      [userId, month, defaultQuota]
    );
    return { used: 0, quota: defaultQuota, remaining: defaultQuota, month };
  }

  async setUsed(userId: string, month: string, used: number): Promise<void> {
    await query(`UPDATE user_credits SET used = $1 WHERE user_id = $2 AND month = $3`, [used, userId, month]);
  }
}
