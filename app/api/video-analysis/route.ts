import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { videoAnalysisRequestSchema, formatValidationError } from '@/lib/validation';
import { RateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { z } from 'zod';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { generateTopicsFromTranscript, generateThemesFromTranscript } from '@/lib/ai-processing';
import { GeminiGenerationError, GeminiErrorType } from '@/lib/gemini-client';
import { hasUnlimitedVideoAllowance } from '@/lib/access-control';
import {
  canGenerateVideo,
  consumeVideoCredit,
  type GenerationDecision,
} from '@/lib/subscription-manager';
import { NO_CREDITS_USED_MESSAGE } from '@/lib/no-credits-message';

function respondWithNoCredits(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(
    {
      ...payload,
      creditsMessage: NO_CREDITS_USED_MESSAGE,
      noCreditsUsed: true,
    },
    { status }
  );
}

function respondWithGeminiError(error: GeminiGenerationError) {
  const statusMap: Record<GeminiErrorType, number> = {
    overloaded: 503,
    'rate limited': 503,
    'authentication failed': 500,
    'invalid request': 500,
    'unknown error': 500
  };

  const messageMap: Record<GeminiErrorType, string> = {
    overloaded: 'Gemini is overloaded right now. Please try again in a few minutes.',
    'rate limited': 'Gemini is temporarily rate-limited. Please wait a moment and try again.',
    'authentication failed': 'We could not authenticate with Gemini. Please try again later.',
    'invalid request': 'The AI service could not process the request. Please try again later.',
    'unknown error': 'Gemini is unavailable right now. Please try again later.'
  };

  const codeMap: Record<GeminiErrorType, string> = {
    overloaded: 'GEMINI_OVERLOADED',
    'rate limited': 'GEMINI_RATE_LIMITED',
    'authentication failed': 'GEMINI_AUTH_ERROR',
    'invalid request': 'GEMINI_INVALID_REQUEST',
    'unknown error': 'GEMINI_UNAVAILABLE'
  };

  const type = error.type ?? 'unknown error';
  const status = statusMap[type] ?? 500;

  return NextResponse.json(
    {
      error: messageMap[type] ?? messageMap['unknown error'],
      code: codeMap[type],
      details: error.message,
      attemptedModels: error.attemptedModels,
      retryable: type === 'overloaded' || type === 'rate limited'
    },
    { status }
  );
}

async function handler(req: NextRequest) {
  try {
    // Parse and validate request body
    const body = await req.json();

    let validatedData;
    try {
      validatedData = videoAnalysisRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedError = formatValidationError(error);
        console.error('[VIDEO-ANALYSIS] Validation error:', formattedError);
        return respondWithNoCredits(
          {
            error: 'Validation failed',
            details: formattedError,
            issues: error.issues
          },
          400
        );
      }
      throw error;
    }

    const {
      videoId,
      videoInfo,
      transcript,
      model,
      forceRegenerate,
      theme,
      mode
    } = validatedData;

    if (theme) {
      try {
        const { topics: themedTopics } = await generateTopicsFromTranscript(transcript, model, {
          videoInfo,
          theme,
          excludeTopicKeys: new Set(validatedData.excludeTopicKeys ?? []),
          includeCandidatePool: false,
          mode
        });

        return NextResponse.json({
          topics: themedTopics,
          theme,
          cached: false,
          topicCandidates: undefined
        });
      } catch (error) {
        console.error('Error generating theme-specific topics:', error);
        if (error instanceof GeminiGenerationError) {
          return respondWithGeminiError(error);
        }
        return respondWithNoCredits(
          { error: 'Failed to generate themed topics. Please try again.' },
          500
        );
      }
    }

    const supabase = await createClient();

    // Get current user if logged in
    const { data: { user } } = await supabase.auth.getUser();

    // Check for cached analysis FIRST (before consuming rate limit)
    if (!forceRegenerate) {
      const { data: cachedVideo } = await supabase
        .from('video_analyses')
        .select('*')
        .eq('youtube_id', videoId)
        .single();

      if (cachedVideo && cachedVideo.topics) {
        // If user is logged in, track their access to this video atomically
        if (user) {
          await supabase.rpc('upsert_video_analysis_with_user_link', {
            p_youtube_id: videoId,
            p_title: cachedVideo.title,
            p_author: cachedVideo.author,
            p_duration: cachedVideo.duration,
            p_thumbnail_url: cachedVideo.thumbnail_url,
            p_transcript: cachedVideo.transcript,
            p_topics: cachedVideo.topics,
            p_summary: cachedVideo.summary || null,  // Ensure null instead of undefined
            p_suggested_questions: cachedVideo.suggested_questions || null,
            p_model_used: cachedVideo.model_used,
            p_user_id: user.id
          });
        }

        let themes: string[] = [];
        try {
          themes = await generateThemesFromTranscript(transcript, videoInfo);
        } catch (error) {
          console.error('Error generating themes for cached video:', error);
        }

        return NextResponse.json({
          topics: cachedVideo.topics,
          transcript: cachedVideo.transcript,
          videoInfo: {
            title: cachedVideo.title,
            author: cachedVideo.author,
            duration: cachedVideo.duration,
            thumbnail: cachedVideo.thumbnail_url
          },
          summary: cachedVideo.summary,
          suggestedQuestions: cachedVideo.suggested_questions,
          themes,
          cached: true,
          cacheDate: cachedVideo.created_at
        });
      }
    }

    // Only apply credit checking for NEW video analysis (not cached)
    const unlimitedAccess = hasUnlimitedVideoAllowance(user);
    let generationDecision: GenerationDecision | null = null;

    if (!unlimitedAccess) {
      if (user) {
        generationDecision = await canGenerateVideo(user.id, videoId, {
          client: supabase,
          skipCacheCheck: true,
        });

        if (!generationDecision.allowed) {
          const tier = generationDecision.subscription?.tier ?? 'free';
          const stats = generationDecision.stats;
          const resetAt =
            stats?.resetAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          let errorMessage = 'Monthly limit reached';
          let upgradeMessage =
            'You have reached your monthly quota. Upgrade your plan to continue.';
          let statusCode = 429;

          if (generationDecision.reason === 'SUBSCRIPTION_INACTIVE') {
            errorMessage = 'Subscription inactive';
            upgradeMessage =
              'Your subscription is not active. Visit the billing portal to reactivate and continue generating videos.';
            statusCode = 402;
          } else if (tier === 'free') {
            upgradeMessage =
              "You've used all 5 free videos this month. Upgrade to Pro for 100 videos/month ($10/mo).";
          } else if (tier === 'pro') {
            if (generationDecision.requiresTopupPurchase) {
              upgradeMessage =
                'You have used all Pro videos this period. Purchase a Top-Up (+20 videos for $3) or wait for your next billing cycle.';
            } else {
              upgradeMessage =
                'You have used your Pro allowance. Wait for your next billing cycle to reset.';
            }
          }

          return NextResponse.json(
            {
              error: errorMessage,
              message: upgradeMessage,
              code: generationDecision.reason,
              tier,
              limit: stats?.baseLimit ?? null,
              remaining: stats?.totalRemaining ?? 0,
              resetAt,
              isAuthenticated: true,
              warning: generationDecision.warning,
              requiresTopup: generationDecision.requiresTopupPurchase ?? false,
            },
            {
              status: statusCode,
              headers: {
                'X-RateLimit-Remaining': String(Math.max(stats?.totalRemaining ?? 0, 0)),
                'X-RateLimit-Reset': resetAt,
              },
            }
          );
        }
      } else {
        const rateLimitConfig = RATE_LIMITS.VIDEO_GENERATION_FREE_UNREGISTERED;
        const rateLimitResult = await RateLimiter.check('video-analysis', rateLimitConfig);

        if (!rateLimitResult.allowed) {
          return NextResponse.json(
            {
              error: 'Sign in to keep analyzing videos',
              message:
                "You've used your free video this month. Create a free account for 5 videos/month, or upgrade to Pro for 100 videos/month.",
              requiresAuth: true,
              redirectTo: '/?auth=limit',
            },
            { status: 429 }
          );
        }
      }
    }

    const generationResult = await generateTopicsFromTranscript(transcript, model, {
      videoInfo,
      includeCandidatePool: validatedData.includeCandidatePool,
      excludeTopicKeys: new Set(validatedData.excludeTopicKeys ?? []),
      mode
    });
    const topics = generationResult.topics;
    const topicCandidates = generationResult.candidates;
    const modelUsed = generationResult.modelUsed;

    let themes: string[] = [];
    try {
      themes = await generateThemesFromTranscript(transcript, videoInfo);
    } catch (error) {
      console.error('Error generating themes:', error);
    }

    if (
      user &&
      !unlimitedAccess &&
      generationDecision?.subscription &&
      generationDecision.stats
    ) {
      const consumeResult = await consumeVideoCredit({
        userId: user.id,
        youtubeId: videoId,
        subscription: generationDecision.subscription,
        statsSnapshot: generationDecision.stats,
        counted: true,
        client: supabase,
      });

      if (!consumeResult.success) {
        console.error('Failed to consume video credit:', consumeResult.error);
      }
    }

    return NextResponse.json({
      topics,
      themes,
      cached: false,
      topicCandidates: validatedData.includeCandidatePool ? topicCandidates ?? [] : undefined,
      modelUsed
    });

  } catch (error) {
    // Log error details server-side only
    console.error('Error in video analysis:', error);

    if (error instanceof GeminiGenerationError) {
      return respondWithGeminiError(error);
    }

    // Return generic error message to client
    return respondWithNoCredits({ error: 'An error occurred while processing your request' }, 500);
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
