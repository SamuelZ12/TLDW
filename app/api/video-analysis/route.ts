import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { videoAnalysisRequestSchema, formatValidationError } from '@/lib/validation';
import { RateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { z } from 'zod';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { generateTopicsFromTranscript, generateThemesFromTranscript } from '@/lib/ai-processing';
import { hasUnlimitedVideoAllowance } from '@/lib/access-control';

async function handler(req: NextRequest) {
  try {
    // Parse and validate request body
    const body = await req.json();

    let validatedData;
    try {
      validatedData = videoAnalysisRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: formatValidationError(error)
          },
          { status: 400 }
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
        return NextResponse.json(
          { error: 'Failed to generate themed topics. Please try again.' },
          { status: 500 }
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

    // Only apply rate limiting for NEW video analysis (not cached)
    const unlimitedAccess = hasUnlimitedVideoAllowance(user);

    if (!unlimitedAccess) {
      const rateLimitConfig = user ? RATE_LIMITS.AUTH_VIDEO_GENERATION : RATE_LIMITS.ANON_GENERATION;
      const rateLimitResult = await RateLimiter.check('video-analysis', rateLimitConfig);

      if (!rateLimitResult.allowed) {
        if (!user) {
          return NextResponse.json(
            {
              error: 'Sign in to keep analyzing videos',
              message: 'You\'ve used today\'s free analysis. Create a free account for unlimited video breakdowns.',
              requiresAuth: true,
              redirectTo: '/?auth=limit'
            },
            { status: 429 }
          );
        }

        const headers: HeadersInit = {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': rateLimitResult.resetAt.toISOString()
        };

        if (typeof rateLimitResult.retryAfter === 'number') {
          headers['Retry-After'] = rateLimitResult.retryAfter.toString();
        }

        return NextResponse.json(
          {
            error: 'Daily limit reached',
            message: 'You get 10 videos per day. Come back tomorrow.',
            code: 'DAILY_VIDEO_LIMIT_REACHED',
            limit: rateLimitConfig.maxRequests,
            remaining: 0,
            resetAt: rateLimitResult.resetAt.toISOString(),
            retryAfter: rateLimitResult.retryAfter ?? null,
            isAuthenticated: true
          },
          {
            status: 429,
            headers
          }
        );
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

    // Return generic error message to client
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
