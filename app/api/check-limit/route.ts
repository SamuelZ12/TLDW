import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { hasUnlimitedVideoAllowance } from '@/lib/access-control';
import {
  canGenerateVideo,
  TIER_LIMITS,
} from '@/lib/subscription-manager';

/**
 * GET /api/check-limit
 *
 * Checks if a user can generate a video based on their subscription tier and usage
 *
 * Response:
 * {
 *   canGenerate: boolean,
 *   isAuthenticated: boolean,
 *   tier?: 'free' | 'pro',
 *   remaining: number | null,
 *   limit: number | null,
 *   topupCredits?: number,
 *   resetAt: string | null,
 *   unlimited?: boolean,
 *   requiresAuth?: boolean
 * }
 */
async function handler(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Check for unlimited access (whitelist)
    const unlimitedAccess = hasUnlimitedVideoAllowance(user);

    if (unlimitedAccess) {
      return NextResponse.json({
        canGenerate: true,
        isAuthenticated: true,
        unlimited: true,
        tier: 'pro',
        status: 'active',
        reason: null,
        warning: null,
        usage: {
          counted: null,
          cached: null,
          baseLimit: null,
          baseRemaining: null,
          topupRemaining: null,
          totalRemaining: null,
        },
        resetAt: null,
        requiresTopup: false,
        willConsumeTopup: false,
      });
    }

    // Handle authenticated users with subscription system
    if (user) {
      const decision = await canGenerateVideo(user.id, undefined, {
        client: supabase,
        skipCacheCheck: true,
      });

      const stats = decision.stats;
      const tier = decision.subscription?.tier ?? 'free';
      const resetAt =
        stats?.resetAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const fallbackBaseLimit = tier === 'pro' ? TIER_LIMITS.pro : TIER_LIMITS.free;

      return NextResponse.json({
        canGenerate: decision.allowed,
        isAuthenticated: true,
        unlimited: false,
        tier,
        status: decision.subscription?.status ?? null,
        reason: decision.allowed ? null : decision.reason,
        warning: decision.warning ?? null,
        resetAt,
        requiresTopup: decision.requiresTopupPurchase ?? false,
        willConsumeTopup: decision.willConsumeTopup ?? false,
        usage: {
          counted: stats?.counted ?? 0,
          cached: stats?.cached ?? 0,
          baseLimit: stats?.baseLimit ?? fallbackBaseLimit,
          baseRemaining: stats?.baseRemaining ?? 0,
          topupRemaining: stats?.topupRemaining ?? 0,
          totalRemaining: stats?.totalRemaining ?? 0,
        },
      });
    }

    // Handle anonymous users with IP-based rate limiting
    const rateLimitConfig = RATE_LIMITS.VIDEO_GENERATION_FREE_UNREGISTERED;
    const rateLimitResult = await RateLimiter.peek(
      'video-analysis',
      rateLimitConfig
    );

    return NextResponse.json({
      canGenerate: rateLimitResult.allowed,
      isAuthenticated: false,
      tier: 'anonymous',
      status: null,
      reason: rateLimitResult.allowed ? null : 'ANON_LIMIT_REACHED',
      warning: null,
      unlimited: false,
      requiresAuth: !rateLimitResult.allowed,
      resetAt: rateLimitResult.resetAt.toISOString(),
      requiresTopup: false,
      willConsumeTopup: false,
      usage: {
        counted: null,
        cached: null,
        baseLimit: rateLimitConfig.maxRequests,
        baseRemaining: rateLimitResult.remaining,
        topupRemaining: 0,
        totalRemaining: rateLimitResult.remaining,
      },
    });
  } catch (error) {
    // Log error details server-side only
    console.error('Error checking generation limit:', error);

    // Return generic error message to client
    return NextResponse.json(
      { error: 'An error occurred while checking limits' },
      { status: 500 }
    );
  }
}

export const GET = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
