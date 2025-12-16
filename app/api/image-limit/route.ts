import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { hasUnlimitedVideoAllowance } from '@/lib/access-control';
import {
  canGenerateImage,
  getImageUsageStats,
  IMAGE_TIER_LIMITS,
} from '@/lib/image-generation-manager';

async function handler() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({
        canGenerate: false,
        isAuthenticated: false,
        requiresAuth: true,
        tier: 'anonymous',
        reason: 'AUTH_REQUIRED',
        remaining: 0,
        limit: IMAGE_TIER_LIMITS.free,
        resetAt: null,
        unlimited: false,
      });
    }

    const unlimited = hasUnlimitedVideoAllowance(user);
    if (unlimited) {
      return NextResponse.json({
        canGenerate: true,
        isAuthenticated: true,
        unlimited: true,
        tier: 'pro',
        reason: null,
        remaining: null,
        limit: null,
        resetAt: null,
      });
    }

    const decision = await canGenerateImage(user.id, { client: supabase });
    const stats =
      decision.stats ??
      (await getImageUsageStats(user.id, { client: supabase }));

    const tier = decision.subscription?.tier ?? 'free';
    const resetAt =
      stats?.resetAt ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    return NextResponse.json({
      canGenerate: decision.allowed,
      isAuthenticated: true,
      unlimited: false,
      tier,
      reason: decision.allowed ? null : decision.reason,
      remaining: stats?.baseRemaining ?? 0,
      limit: stats?.baseLimit ?? IMAGE_TIER_LIMITS[tier],
      resetAt,
    });
  } catch (error) {
    console.error('Error checking image limit:', error);
    return NextResponse.json(
      { error: 'Failed to check image limits' },
      { status: 500 }
    );
  }
}

export const GET = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
