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
import { creditsRepo } from "@/lib/repositories";
import type { CreditStatus } from "@/lib/repositories/credits";

const DEFAULT_QUOTA = 2_500;

export const ACTION_COSTS: Record<string, number> = {
  delta: 3,
  solo: 1,
  insights: 4,
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type { CreditStatus };

export async function getCreditStatus(userId: string): Promise<CreditStatus> {
  return creditsRepo.getOrCreateStatus(userId, currentMonth(), DEFAULT_QUOTA);
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

  await creditsRepo.setUsed(userId, status.month, status.used + cost);

  return { allowed: true, remaining: status.remaining - cost, cost };
}
