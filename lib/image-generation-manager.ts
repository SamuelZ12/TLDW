import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { SubscriptionTier, UserSubscription } from '@/lib/subscription-manager';
import { getUserSubscriptionStatus } from '@/lib/subscription-manager';

export interface ImageUsageStats {
  tier: SubscriptionTier;
  baseLimit: number;
  counted: number;
  baseRemaining: number;
  periodStart: Date;
  periodEnd: Date;
  resetAt: string;
}

export interface ImageGenerationDecision {
  allowed: boolean;
  reason: 'OK' | 'LIMIT_REACHED' | 'SUBSCRIPTION_INACTIVE' | 'NO_SUBSCRIPTION';
  subscription?: UserSubscription | null;
  stats?: ImageUsageStats | null;
}

type DatabaseClient = SupabaseClient<any, string, any>;

export const IMAGE_TIER_LIMITS: Record<SubscriptionTier, number> = {
  free: 5,
  pro: 100,
};

const BILLING_PERIOD_DAYS = 30;
const THIRTY_DAYS_MS = BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000;

function resolveBillingPeriod(subscription: UserSubscription, now: Date): { start: Date; end: Date } {
  // Pro users: prefer Stripe billing window
  if (
    subscription.tier === 'pro' &&
    subscription.currentPeriodStart &&
    subscription.currentPeriodEnd
  ) {
    return {
      start: subscription.currentPeriodStart,
      end: subscription.currentPeriodEnd,
    };
  }

  // Free users: rolling 30-day windows anchored to signup
  if (subscription.userCreatedAt) {
    const signupTime = subscription.userCreatedAt.getTime();
    const elapsedMs = now.getTime() - signupTime;
    const cycleNumber = Math.floor(elapsedMs / THIRTY_DAYS_MS);
    const periodStartMs = signupTime + (cycleNumber * THIRTY_DAYS_MS);
    const periodEndMs = periodStartMs + THIRTY_DAYS_MS;
    return {
      start: new Date(periodStartMs),
      end: new Date(periodEndMs),
    };
  }

  // Fallback: rolling 30 days
  const end = now;
  const start = new Date(end.getTime() - THIRTY_DAYS_MS);
  return { start, end };
}

async function fetchImageUsageInPeriod(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  options?: { client?: DatabaseClient }
): Promise<number> {
  const supabase = options?.client ?? (await createClient());

  const { data, error } = await supabase.rpc('get_image_usage_breakdown', {
    p_user_id: userId,
    p_start: periodStart.toISOString(),
    p_end: periodEnd.toISOString(),
  });

  if (error) {
    console.error('Failed to fetch image usage breakdown:', error);
    return 0;
  }

  if (!Array.isArray(data)) {
    return 0;
  }

  return data.reduce((sum, row) => sum + Number(row.counted ?? 0), 0);
}

export async function getImageUsageStats(
  userId: string,
  options?: { client?: DatabaseClient; now?: Date }
): Promise<ImageUsageStats | null> {
  const supabase = options?.client ?? (await createClient());
  const subscription = await getUserSubscriptionStatus(userId, { client: supabase });

  if (!subscription) {
    return null;
  }

  const now = options?.now ?? new Date();
  const { start, end } = resolveBillingPeriod(subscription, now);
  const baseLimit = IMAGE_TIER_LIMITS[subscription.tier];

  const counted = await fetchImageUsageInPeriod(userId, start, end, { client: supabase });
  const baseRemaining = Math.max(0, baseLimit - counted);

  return {
    tier: subscription.tier,
    baseLimit,
    counted,
    baseRemaining,
    periodStart: start,
    periodEnd: end,
    resetAt: end.toISOString(),
  };
}

export async function canGenerateImage(
  userId: string,
  options?: { client?: DatabaseClient; now?: Date }
): Promise<ImageGenerationDecision> {
  const supabase = options?.client ?? (await createClient());
  const now = options?.now ?? new Date();
  const subscription = await getUserSubscriptionStatus(userId, { client: supabase });

  if (!subscription) {
    return { allowed: false, reason: 'NO_SUBSCRIPTION' };
  }

  const stats = await getImageUsageStats(userId, { client: supabase, now });

  if (!stats) {
    return {
      allowed: false,
      reason: 'NO_SUBSCRIPTION',
      subscription,
      stats: null,
    };
  }

  // Pro users must be active/trialing/past_due; otherwise block
  if (
    subscription.tier === 'pro' &&
    subscription.status &&
    !['active', 'trialing', 'past_due'].includes(subscription.status)
  ) {
    return {
      allowed: false,
      reason: 'SUBSCRIPTION_INACTIVE',
      subscription,
      stats,
    };
  }

  if (stats.baseRemaining <= 0) {
    return {
      allowed: false,
      reason: 'LIMIT_REACHED',
      subscription,
      stats,
    };
  }

  return {
    allowed: true,
    reason: 'OK',
    subscription,
    stats,
  };
}

export async function consumeImageCreditAtomic({
  userId,
  youtubeId,
  subscription,
  statsSnapshot,
  videoAnalysisId,
  counted = true,
  client,
}: {
  userId: string;
  youtubeId: string;
  subscription: UserSubscription;
  statsSnapshot: ImageUsageStats;
  videoAnalysisId?: string | null;
  counted?: boolean;
  client?: DatabaseClient;
}): Promise<{ success: boolean; generationId?: string; error?: string }> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase.rpc('consume_image_credit_atomically', {
    p_user_id: userId,
    p_youtube_id: youtubeId,
    p_subscription_tier: subscription.tier,
    p_base_limit: IMAGE_TIER_LIMITS[subscription.tier],
    p_period_start: statsSnapshot.periodStart.toISOString(),
    p_period_end: statsSnapshot.periodEnd.toISOString(),
    p_video_id: videoAnalysisId ?? null,
    p_counted: counted,
  });

  if (error) {
    console.error('Atomic image credit consumption failed:', error);
    return { success: false, error: 'ATOMIC_CONSUMPTION_FAILED' };
  }

  const result = data as any;
  if (!result || !result.allowed) {
    return { success: false, error: result?.reason ?? 'LIMIT_REACHED' };
  }

  return { success: true, generationId: result.generation_id };
}
