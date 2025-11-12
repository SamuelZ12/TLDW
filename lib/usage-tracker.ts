import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface PeriodBounds {
  start: Date;
  end: Date;
}

export interface UsageBreakdown {
  counted: number;
  cached: number;
  total: number;
  byTier: Record<string, { counted: number; cached: number }>;
}

type UsageTrackerClient = SupabaseClient<any, string, any>;

interface UsageInPeriodParams {
  userId: string;
  start: Date;
  end: Date;
  client?: UsageTrackerClient;
}

/**
 * Returns the start and end of a rolling 30-day window from the given start date.
 */
export function getPeriodBounds(subStart: Date): PeriodBounds {
  const start = new Date(subStart);
  const end = new Date(start.getTime() + THIRTY_DAYS_MS);
  return { start, end };
}

/**
 * Aggregates usage for a user inside the provided window.
 * Relies on the Supabase RPC `get_usage_breakdown` to avoid downloading every row.
 */
export async function fetchUsageBreakdown({
  userId,
  start,
  end,
  client,
}: UsageInPeriodParams): Promise<UsageBreakdown> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase.rpc('get_usage_breakdown', {
    p_user_id: userId,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });

  if (error) {
    console.error('Failed to compute usage breakdown:', error);
    throw error;
  }

  const breakdown: UsageBreakdown = {
    counted: 0,
    cached: 0,
    total: 0,
    byTier: {},
  };

  if (!Array.isArray(data)) {
    return breakdown;
  }

  for (const row of data) {
    const tier = row.subscription_tier ?? 'unknown';
    const counted = Number(row.counted ?? 0);
    const cached = Number(row.cached ?? 0);

    breakdown.byTier[tier] = { counted, cached };
    breakdown.counted += counted;
    breakdown.cached += cached;
  }

  breakdown.total = breakdown.counted + breakdown.cached;

  return breakdown;
}

interface RemainingCreditParams {
  baseLimit: number;
  countedUsage: number;
  topupCredits: number;
}

export interface RemainingCredits {
  baseRemaining: number;
  topupRemaining: number;
  totalRemaining: number;
}

/**
 * Calculates remaining credits given base usage, base limit, and stored top-up credits.
 */
export function getRemainingCredits({
  baseLimit,
  countedUsage,
  topupCredits,
}: RemainingCreditParams): RemainingCredits {
  const baseRemaining = Math.max(0, baseLimit - countedUsage);
  const topupRemaining = Math.max(0, topupCredits);
  return {
    baseRemaining,
    topupRemaining,
    totalRemaining: baseRemaining + topupRemaining,
  };
}

/**
 * Formats a reset timestamp for display and API responses.
 */
export function formatResetAt(date: Date): string {
  return date.toISOString();
}
