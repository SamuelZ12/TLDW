import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  videoAnalysisRequestSchema,
  formatValidationError
} from '@/lib/validation';
import { z } from 'zod';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import {
  generateTopicsFromTranscript,
  generateThemesFromTranscript
} from '@/lib/ai-processing';
import { hasUnlimitedVideoAllowance } from '@/lib/access-control';
import {
  canGenerateVideo,
  consumeVideoCreditAtomic,
  type GenerationDecision
} from '@/lib/subscription-manager';
import { NO_CREDITS_USED_MESSAGE } from '@/lib/no-credits-message';
import { ensureMergedFormat } from '@/lib/transcript-format-detector';
import { TranscriptSegment } from '@/lib/types';
import { getGuestAccessState, recordGuestUsage, setGuestCookies } from '@/lib/guest-usage';

function respondWithNoCredits(
  payload: Record<string, unknown>,
  status: number
) {
  return NextResponse.json(
    {
      ...payload,
      creditsMessage: NO_CREDITS_USED_MESSAGE,
      noCreditsUsed: true
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
        return respondWithNoCredits(
          {
            error: 'Validation failed',
            details: formatValidationError(error)
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

    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    const guestState = user ? null : await getGuestAccessState({ supabase });
    const unlimitedAccess = hasUnlimitedVideoAllowance(user);

    let cachedVideo: any = null;
    if (!forceRegenerate) {
      const { data } = await supabase
        .from('video_analyses')
        .select('*')
        .eq('youtube_id', videoId)
        .single();

      cachedVideo = data ?? null;
    }

    const isCachedAnalysis = Boolean(cachedVideo?.topics);

    if (theme) {
      // Guests only get one fresh analysis; allow themed queries for cached videos
      if (!user && guestState?.used && !isCachedAnalysis) {
        const response = respondWithNoCredits(
          {
            error: 'Sign in to analyze videos',
            message: 'You have used your free preview. Create a free account to keep analyzing videos.',
            requiresAuth: true,
            redirectTo: '/?auth=signup'
          },
          401
        );

        setGuestCookies(response, guestState);
        return response;
      }

      try {
        const { topics: themedTopics } = await generateTopicsFromTranscript(
          transcript,
          model,
          {
            videoInfo,
            theme,
            excludeTopicKeys: new Set(validatedData.excludeTopicKeys ?? []),
            includeCandidatePool: false,
            mode
          }
        );

        // If no topics were generated for the theme, it means the AI couldn't find relevant content
        if (themedTopics.length === 0) {
          console.log(`[video-analysis] No content found for theme: "${theme}"`);
          return NextResponse.json({
            topics: [],
            theme,
            cached: false,
            topicCandidates: undefined,
            error: `No content found for theme: "${theme}"`
          });
        }

        const response = NextResponse.json({
          topics: themedTopics,
          theme,
          cached: false,
          topicCandidates: undefined
        });

        if (!user && guestState) {
          // Consume the one-time guest allowance only when this isn't a cached analysis
          const shouldConsumeGuest = !guestState.used && !isCachedAnalysis;
          if (shouldConsumeGuest) {
            await recordGuestUsage(guestState, { supabase });
          }
          setGuestCookies(response, guestState, {
            markUsed: shouldConsumeGuest
          });
        }

        return response;
      } catch (error) {
        console.error('Error generating theme-specific topics:', error);
        return respondWithNoCredits(
          { error: 'Failed to generate themed topics. Please try again.' },
          500
        );
      }
    }

    // Check for cached analysis FIRST (before consuming rate limit)
    if (!forceRegenerate && cachedVideo && cachedVideo.topics) {
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
          p_summary: cachedVideo.summary || null, // Ensure null instead of undefined
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

      // Ensure transcript is in merged format (backward compatibility for old cached videos)
      const originalTranscript = cachedVideo.transcript as TranscriptSegment[];
      const migratedTranscript = ensureMergedFormat(originalTranscript, {
        enableLogging: true,
        context: `YouTube ID: ${videoId}`
      });

      const response = NextResponse.json({
        topics: cachedVideo.topics,
        transcript: migratedTranscript,
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

      if (!user && guestState) {
        setGuestCookies(response, guestState);
      }

      return response;
    }

    // Only apply credit checking for NEW video analysis (not cached)
    let generationDecision: GenerationDecision | null = null;

    if (!user) {
      if (guestState?.used) {
        const response = respondWithNoCredits(
          {
            error: 'Sign in to analyze videos',
            message: 'You have used your free preview. Create a free account for 3 videos/month or upgrade for more.',
            requiresAuth: true,
            redirectTo: '/?auth=signup'
          },
          401
        );

        if (guestState) {
          setGuestCookies(response, guestState);
        }

        return response;
      }
    } else if (!unlimitedAccess) {
      generationDecision = await canGenerateVideo(user.id, videoId, {
        client: supabase,
        skipCacheCheck: true
      });

      if (!generationDecision.allowed) {
        const tier = generationDecision.subscription?.tier ?? 'free';
        const stats = generationDecision.stats;
        const resetAt =
          stats?.resetAt ??
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

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
            "You've used all 3 free videos this month. Upgrade to Pro for 100 videos/month ($10/mo).";
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
            requiresTopup: generationDecision.requiresTopupPurchase ?? false
          },
          {
            status: statusCode,
            headers: {
              'X-RateLimit-Remaining': String(
                Math.max(stats?.totalRemaining ?? 0, 0)
              ),
              'X-RateLimit-Reset': resetAt
            }
          }
        );
      }
    }

    const generationResult = await generateTopicsFromTranscript(
      transcript,
      model,
      {
        videoInfo,
        includeCandidatePool: validatedData.includeCandidatePool,
        excludeTopicKeys: new Set(validatedData.excludeTopicKeys ?? []),
        mode
      }
    );
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
      const consumeResult = await consumeVideoCreditAtomic({
        userId: user.id,
        youtubeId: videoId,
        subscription: generationDecision.subscription,
        statsSnapshot: generationDecision.stats,
        counted: true
      });

      if (!consumeResult.success) {
        console.error('Failed to consume video credit:', consumeResult.error);
      }
    }

    if (!user && guestState) {
      await recordGuestUsage(guestState, { supabase });
    }

    const response = NextResponse.json({
      topics,
      themes,
      cached: false,
      topicCandidates: validatedData.includeCandidatePool
        ? topicCandidates ?? []
        : undefined,
      modelUsed
    });

    if (!user && guestState) {
      setGuestCookies(response, guestState, { markUsed: true });
    }

    return response;
  } catch (error) {
    // Log error details server-side only
    console.error('Error in video analysis:', error);

    // Return generic error message to client
    return respondWithNoCredits(
      { error: 'An error occurred while processing your request' },
      500
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
