import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { getUserSubscriptionStatus, getUsageStats } from '@/lib/subscription-manager';

/**
 * GET /api/subscription/status
 *
 * Returns the current user's subscription status, usage statistics, and limits
 *
 * Response:
 * {
 *   tier: 'free' | 'pro',
 *   status: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing' | null,
 *   usage: {
 *     used: number,
 *     limit: number,
 *     topupCredits: number,
 *     remaining: number
 *   },
 *   period: {
 *     start: string (ISO date),
 *     end: string (ISO date)
 *   },
 *   cancelAtPeriodEnd: boolean,
 *   stripeCustomerId: string | null
 * }
 */
async function handler(req: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get subscription status
    const subscription = await getUserSubscriptionStatus(user.id, { client: supabase });

    if (!subscription) {
      return NextResponse.json(
        { error: 'Unable to fetch subscription status' },
        { status: 500 }
      );
    }

    // Get usage statistics
    const stats = await getUsageStats(user.id, { client: supabase });

    if (!stats) {
      return NextResponse.json(
        { error: 'Unable to fetch usage statistics' },
        { status: 500 }
      );
    }

    const nextBillingDate = subscription.currentPeriodEnd
      ? subscription.currentPeriodEnd.toISOString()
      : null;

    const willConsumeTopup = stats.baseRemaining <= 0 && stats.topupRemaining > 0;

    return NextResponse.json({
      tier: subscription.tier,
      status: subscription.status,
      stripeCustomerId: subscription.stripeCustomerId,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      isPastDue: subscription.status === 'past_due',
      canPurchaseTopup: subscription.tier === 'pro',
      nextBillingDate,
      period: {
        start: stats.periodStart.toISOString(),
        end: stats.periodEnd.toISOString(),
      },
      usage: {
        counted: stats.counted,
        cached: stats.cached,
        baseLimit: stats.baseLimit,
        baseRemaining: stats.baseRemaining,
        topupCredits: stats.topupCredits,
        topupRemaining: stats.topupRemaining,
        totalRemaining: stats.totalRemaining,
        resetAt: stats.resetAt,
      },
      willConsumeTopup,
    }, {
      headers: {
        // Allow caching for 30 seconds to reduce database load during polling
        'Cache-Control': 'private, max-age=30, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error in subscription status API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription status' },
      { status: 500 }
    );
  }
}

export const GET = withSecurity(handler, SECURITY_PRESETS.AUTHENTICATED_READ_ONLY);
