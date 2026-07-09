import { supabaseAdmin } from "@/lib/supabase/admin";

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
