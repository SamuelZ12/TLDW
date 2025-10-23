import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  identifier?: string; // Custom identifier (user ID, IP, etc.)
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // Seconds until next request allowed
}

const loggedRateLimiterMessages = new Set<string>();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let rateLimiterEnabled = Boolean(supabaseUrl && supabaseAnonKey);

function logRateLimiterMessage(message: string, error?: unknown) {
  if (loggedRateLimiterMessages.has(message)) {
    return;
  }
  loggedRateLimiterMessages.add(message);
  if (error) {
    console.warn(`[RateLimiter] ${message}`, error);
  } else {
    console.warn(`[RateLimiter] ${message}`);
  }
}

function disableRateLimiter(reason: string, error?: unknown) {
  if (!rateLimiterEnabled) {
    return;
  }
  rateLimiterEnabled = false;
  logRateLimiterMessage(`Disabled: ${reason}`, error);
}

function isConfigurationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';
  const details = typeof record.details === 'string' ? record.details : '';
  const combined = `${message} ${details}`.toLowerCase();

  if (code === '42P01') {
    // Undefined table error in Postgres
    return true;
  }

  return combined.includes('rate_limits') && combined.includes('does not exist');
}

async function getAnonymousIdentifier(): Promise<string> {
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for');
  const realIp = headersList.get('x-real-ip');
  const ip = forwardedFor?.split(',')[0] || realIp || 'unknown';

  const hash = crypto.createHash('sha256').update(ip).digest('hex');
  return `anon:${hash.substring(0, 16)}`;
}

function buildFallbackResult(config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  return {
    allowed: true,
    remaining: config.maxRequests,
    resetAt: new Date(now + config.windowMs)
  };
}

if (!rateLimiterEnabled) {
  logRateLimiterMessage('Disabled: Supabase configuration missing.');
}

export class RateLimiter {
  private static async getIdentifier(customId?: string): Promise<string> {
    if (customId) return customId;

    if (!rateLimiterEnabled) {
      return getAnonymousIdentifier();
    }

    try {
      const supabase = await createClient();
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error) {
        throw error;
      }

      if (user) {
        return `user:${user.id}`;
      }
    } catch (error) {
      if (isConfigurationError(error)) {
        disableRateLimiter('Supabase authentication unavailable', error);
      } else {
        logRateLimiterMessage(
          'Falling back to anonymous identifiers due to auth lookup failure.',
          error
        );
      }
      return getAnonymousIdentifier();
    }

    return getAnonymousIdentifier();
  }

  static async peek(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const identifier = await this.getIdentifier(config.identifier);
    if (!rateLimiterEnabled) {
      return buildFallbackResult(config);
    }

    const rateLimitKey = `ratelimit:${key}:${identifier}`;

    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      const supabase = await createClient();

      // Count recent requests without modifying
      const { data: recentRequests, error: countError } = await supabase
        .from('rate_limits')
        .select('id')
        .eq('key', rateLimitKey)
        .gte('timestamp', new Date(windowStart).toISOString());

      if (countError) throw countError;

      const requestCount = recentRequests?.length || 0;
      const remaining = Math.max(0, config.maxRequests - requestCount);
      const resetAt = new Date(now + config.windowMs);

      if (requestCount >= config.maxRequests) {
        // Calculate when the oldest request will expire
        const { data: oldestRequest } = await supabase
          .from('rate_limits')
          .select('timestamp')
          .eq('key', rateLimitKey)
          .order('timestamp', { ascending: true })
          .limit(1)
          .single();

        let retryAfter = Math.ceil(config.windowMs / 1000);
        if (oldestRequest) {
          const oldestTime = new Date(oldestRequest.timestamp).getTime();
          retryAfter = Math.ceil((oldestTime + config.windowMs - now) / 1000);
        }

        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter
        };
      }

      return {
        allowed: true,
        remaining,
        resetAt
      };
    } catch (error) {
      if (isConfigurationError(error) || !rateLimiterEnabled) {
        disableRateLimiter('Supabase rate_limits table unavailable', error);
      } else {
        logRateLimiterMessage('Falling back due to rate limiter peek error.', error);
      }
      return buildFallbackResult(config);
    }
  }

  static async check(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const identifier = await this.getIdentifier(config.identifier);
    if (!rateLimiterEnabled) {
      return buildFallbackResult(config);
    }

    const rateLimitKey = `ratelimit:${key}:${identifier}`;

    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      const supabase = await createClient();

      // First, clean up old entries
      await supabase
        .from('rate_limits')
        .delete()
        .lt('timestamp', new Date(windowStart).toISOString());

      // Count recent requests
      const { data: recentRequests, error: countError } = await supabase
        .from('rate_limits')
        .select('id')
        .eq('key', rateLimitKey)
        .gte('timestamp', new Date(windowStart).toISOString());

      if (countError) throw countError;

      const requestCount = recentRequests?.length || 0;
      const remaining = Math.max(0, config.maxRequests - requestCount);
      const resetAt = new Date(now + config.windowMs);

      if (requestCount >= config.maxRequests) {
        // Calculate when the oldest request will expire
        const { data: oldestRequest } = await supabase
          .from('rate_limits')
          .select('timestamp')
          .eq('key', rateLimitKey)
          .order('timestamp', { ascending: true })
          .limit(1)
          .single();

        let retryAfter = Math.ceil(config.windowMs / 1000);
        if (oldestRequest) {
          const oldestTime = new Date(oldestRequest.timestamp).getTime();
          retryAfter = Math.ceil((oldestTime + config.windowMs - now) / 1000);
        }

        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter
        };
      }

      // Record this request
      const { error: insertError } = await supabase
        .from('rate_limits')
        .insert({
          key: rateLimitKey,
          timestamp: new Date(now).toISOString(),
          identifier
        });

      if (insertError) {
        if (isConfigurationError(insertError)) {
          disableRateLimiter('Supabase rate_limits table unavailable', insertError);
        } else {
          logRateLimiterMessage('Failed to insert rate limit record; allowing request.', insertError);
        }
        return buildFallbackResult(config);
      }

      return {
        allowed: true,
        remaining: remaining - 1,
        resetAt
      };
    } catch (error) {
      if (isConfigurationError(error) || !rateLimiterEnabled) {
        disableRateLimiter('Supabase rate_limits table unavailable', error);
      } else {
        logRateLimiterMessage('Falling back due to rate limiter error.', error);
      }
      return buildFallbackResult(config);
    }
  }

  static async reset(key: string, identifier?: string): Promise<void> {
    const id = await this.getIdentifier(identifier);
    if (!rateLimiterEnabled) {
      return;
    }

    const rateLimitKey = `ratelimit:${key}:${id}`;

    try {
      const supabase = await createClient();
      await supabase
        .from('rate_limits')
        .delete()
        .eq('key', rateLimitKey);
    } catch (error) {
      if (isConfigurationError(error) || !rateLimiterEnabled) {
        disableRateLimiter('Supabase rate_limits table unavailable', error);
      } else {
        logRateLimiterMessage('Failed to reset rate limit entry; ignoring.', error);
      }
    }
  }
}

// Preset configurations for different endpoints
export const RATE_LIMITS = {
  // Anonymous users
  ANON_GENERATION: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 1 // 1 generation per day
  },
  ANON_CHAT: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10 // 10 messages per minute
  },

  // Authenticated users
  AUTH_GENERATION: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20 // 20 generations per hour
  },
  AUTH_VIDEO_GENERATION: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 10 // 10 generations per day
  },
  AUTH_CHAT: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30 // 30 messages per minute
  },

  // General API endpoints
  API_GENERAL: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60 // 60 requests per minute
  },

  // Sensitive operations
  AUTH_ATTEMPT: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5 // 5 login attempts per 15 minutes
  }
};

// Helper function for API responses
export function rateLimitResponse(result: RateLimitResult): NextResponse | null {
  const headers: HeadersInit = {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toISOString()
  };

  if (!result.allowed && result.retryAfter) {
    headers['Retry-After'] = result.retryAfter.toString();

    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again in ${result.retryAfter} seconds.`,
        retryAfter: result.retryAfter,
        resetAt: result.resetAt
      },
      {
        status: 429,
        headers
      }
    );
  }

  return null; // Request allowed
}
