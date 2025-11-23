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
import { extractVideoId } from '@/lib/utils';

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

    // Require authentication before any video analysis
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return respondWithNoCredits(
        {
          error: 'Sign in to analyze videos',
          message:
            'Create a free account to get 5 analyses per month, or upgrade to Pro for 100 analyses per month.',
          requiresAuth: true,
          redirectTo: '/?auth=signup',
        },
        401
      );
    }

    const unlimitedAccess = hasUnlimitedVideoAllowance(user);

    if (theme) {
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

        return NextResponse.json({
          topics: themedTopics,
          theme,
          cached: false,
          topicCandidates: undefined
        });
      } catch (error) {
        console.error('Error generating theme-specific topics:', error);
        return respondWithNoCredits(
          { error: 'Failed to generate themed topics. Please try again.' },
          500
        );
      }
    }

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

        return NextResponse.json({
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
      }
    }

    // Only apply credit checking for NEW video analysis (not cached)
    let generationDecision: GenerationDecision | null = null;

    if (!unlimitedAccess) {
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

    return NextResponse.json({
      topics,
      themes,
      cached: false,
      topicCandidates: validatedData.includeCandidatePool
        ? topicCandidates ?? []
        : undefined,
      modelUsed
    });
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

async function deleteHandler(req: NextRequest) {
  try {
    const { url, videoId: directVideoId } = await req.json();

    // Accept either a YouTube URL or a direct video ID
    const videoId = directVideoId || (url ? extractVideoId(url) : null);

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID or URL is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Only allow admins to delete video analysis
    if (!hasUnlimitedVideoAllowance(user)) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Delete the video analysis from database
    const { error, count } = await supabase
      .from('video_analyses')
      .delete()
      .eq('youtube_id', videoId)
      .select();

    if (error) {
      console.error('Error deleting video analysis:', error);
      return NextResponse.json(
        { error: 'Failed to delete video analysis' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      videoId,
      deleted: count !== null && count > 0
    });
  } catch (error) {
    console.error('Error in delete video analysis:', error);
    return NextResponse.json(
      { error: 'Failed to delete video analysis' },
      { status: 500 }
    );
  }
}

export const DELETE = withSecurity(deleteHandler, {
  ...SECURITY_PRESETS.AUTHENTICATED,
  allowedMethods: ['DELETE']
});
