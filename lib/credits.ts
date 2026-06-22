/**
 * User credits system.
 * 1 credit = $0.01. Default monthly quota = 600 ($6).
 *
 * Cost per action:
 *   Delta Analysis:    3 credits ($0.03)
 *   Deep Dive:         1 credit  ($0.01)
 *   Multi-Quarter:     4 credits ($0.04)
 *   Screener/etc:      0 credits (DB reads)
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

const DEFAULT_QUOTA = 600;

export const ACTION_COSTS: Record<string, number> = {
  delta: 3,
  solo: 1,
  insights: 4,
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface CreditStatus {
  used: number;
  quota: number;
  remaining: number;
  month: string;
}

export async function getCreditStatus(userId: string): Promise<CreditStatus> {
  const month = currentMonth();

  const { data } = await supabaseAdmin()
    .from("user_credits")
    .select("used, quota")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();

  if (data) {
    return { used: data.used, quota: data.quota, remaining: data.quota - data.used, month };
  }

  // First access this month — create row
  await supabaseAdmin()
    .from("user_credits")
    .upsert({ user_id: userId, month, used: 0, quota: DEFAULT_QUOTA }, { onConflict: "user_id,month" });

  return { used: 0, quota: DEFAULT_QUOTA, remaining: DEFAULT_QUOTA, month };
}

export async function checkAndDeduct(
  userId: string,
  action: string
): Promise<{ allowed: boolean; remaining: number; cost: number }> {
  const cost = ACTION_COSTS[action] ?? 0;
  if (cost === 0) return { allowed: true, remaining: 0, cost: 0 };

  const status = await getCreditStatus(userId);

  if (status.remaining < cost) {
    return { allowed: false, remaining: status.remaining, cost };
  }

  // Deduct
  await supabaseAdmin()
    .from("user_credits")
    .update({ used: status.used + cost })
    .eq("user_id", userId)
    .eq("month", status.month);

  return { allowed: true, remaining: status.remaining - cost, cost };
}
