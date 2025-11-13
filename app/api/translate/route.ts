import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS, RateLimiter, rateLimitResponse } from '@/lib/rate-limiter';
import { getTranslationClient } from '@/lib/translation';
import { createClient } from '@/lib/supabase/server';
import { getUserSubscriptionStatus } from '@/lib/subscription-manager';
import { z } from 'zod';

const translateBatchRequestSchema = z.object({
  texts: z.array(z.string()),
  targetLanguage: z.string().default('zh-CN')
});

// Optional in-process cache for subscription access to reduce DB roundtrips
const SUBSCRIPTION_TTL_MS = 30_000; // 30s
const proAccessCache = new Map<string, { value: boolean; expires: number }>();

async function getHasProAccess(userId: string, supabase: any) {
  const now = Date.now();
  const cached = proAccessCache.get(userId);
  if (cached && cached.expires > now) return cached.value;

  const subscription = await getUserSubscriptionStatus(userId, { client: supabase });
  const hasProAccess =
    subscription?.tier === 'pro' &&
    (subscription.status === 'active' ||
      subscription.status === 'trialing' ||
      subscription.status === 'past_due');

  proAccessCache.set(userId, { value: !!hasProAccess, expires: now + SUBSCRIPTION_TTL_MS });
  return hasProAccess;
}

async function handler(request: NextRequest) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
    const body = requestBody;

    // Auth check first (cheap), then optional rate limiting
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Translation is a Pro feature. Sign in and upgrade to use it.' },
        { status: 403 }
      );
    }

    // Cache subscription lookup briefly to avoid repeated DB reads
    const hasProAccess = await getHasProAccess(user.id, supabase);
    if (!hasProAccess) {
      return NextResponse.json(
        { error: 'Translation is available on Pro. Upgrade to enable it.' },
        { status: 403 }
      );
    }

    // Optional rate limiting (disabled by default for speed)
    const enableRateLimit = process.env.TRANSLATION_RATE_LIMIT_ENABLED === 'true';
    let rateLimitHeaders: Record<string, string> | undefined;
    if (enableRateLimit) {
      const rateLimitConfig = RATE_LIMITS.AUTH_TRANSLATION;
      const rateLimitResult = await RateLimiter.check('translation', rateLimitConfig);
      if (!rateLimitResult.allowed) {
        return (
          rateLimitResponse(rateLimitResult) ||
          NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
        );
      }
      rateLimitHeaders = {
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.resetAt.toISOString()
      };
    }

    const validation = translateBatchRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid request format',
          details: validation.error.flatten()
        },
        { status: 400 }
      );
    }

    const { texts, targetLanguage } = validation.data;

    if (texts.length === 0) {
      return NextResponse.json({ translations: [] });
    }

    // Allow large batches; server will internally chunk and parallelize
    const MAX_REQUEST_TEXTS = 10000;
    if (texts.length > MAX_REQUEST_TEXTS) {
      return NextResponse.json(
        { error: `Batch size too large. Maximum ${MAX_REQUEST_TEXTS} texts allowed.` },
        { status: 400 }
      );
    }

    // Internally chunk into safe sizes and process with limited concurrency
    const translationClient = getTranslationClient();

    const CHUNK_SIZE = 100; // keep provider calls reasonable
    const CONCURRENCY = 4; // parallel calls without overwhelming provider

    function chunk<T>(arr: T[], size: number): T[][] {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    }

    const chunks = chunk(texts, CHUNK_SIZE);
    const results: string[] = new Array(texts.length);

    // Run with basic concurrency control
    let index = 0;
    async function worker() {
      while (index < chunks.length) {
        const myIndex = index++;
        const translated = await translationClient.translateBatch(chunks[myIndex], targetLanguage);
        // place back preserving order
        const start = myIndex * CHUNK_SIZE;
        for (let i = 0; i < translated.length; i++) {
          results[start + i] = translated[i];
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker());
    await Promise.all(workers);

    // Include rate limit headers if applicable
    return NextResponse.json(
      { translations: results },
      { headers: rateLimitHeaders ?? {} }
    );
  } catch (error) {
    // Log full error details server-side for debugging
    console.error('[TRANSLATE] Translation error:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: requestBody || 'Unable to parse request body',
      timestamp: new Date().toISOString()
    });

    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        return NextResponse.json(
          { error: 'Translation service configuration error' },
          { status: 500 }
        );
      }
      if (error.message.includes('quota') || error.message.includes('limit')) {
        return NextResponse.json(
          { error: 'Translation service quota exceeded' },
          { status: 429 }
        );
      }
    }

    return NextResponse.json({ error: 'Translation failed' }, { status: 500 });
  }
}

// Apply security middleware
// Note: Rate limiting is handled inside the handler to support different limits for anon/auth users
export const POST = withSecurity(handler, {
  maxBodySize: 3 * 1024 * 1024, // 3MB to allow larger batches
  allowedMethods: ['POST']
});
