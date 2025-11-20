import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractVideoId } from '@/lib/utils';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { ensureMergedFormat } from '@/lib/transcript-format-detector';
import { TranscriptSegment } from '@/lib/types';

async function handler(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Extract video ID from URL
    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get current user if logged in
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: 'Sign in to view video analyses',
          requiresAuth: true,
          cached: false,
          videoId
        },
        { status: 401 }
      );
    }

    // Check for cached video
    const { data: cachedVideo } = await supabase
      .from('video_analyses')
      .select('*')
      .eq('youtube_id', videoId)
      .single();

    if (cachedVideo && cachedVideo.topics) {
      let ownedByCurrentUser = false;

      if (user?.id) {
        if (cachedVideo.user_id && cachedVideo.user_id === user.id) {
          ownedByCurrentUser = true;
        } else {
          const ownershipQuery = supabase
            .from('video_generations')
            .select('id')
            .eq('user_id', user.id)
            .limit(1);

          const orConditions: string[] = [];

          if (cachedVideo.id) {
            orConditions.push(`video_id.eq.${cachedVideo.id}`);
          }
          if (videoId) {
            orConditions.push(`youtube_id.eq.${videoId}`);
          }

          if (orConditions.length > 0) {
            ownershipQuery.or(orConditions.join(','));
          }

          const { data: generationLink, error: generationError } = await ownershipQuery.maybeSingle();

          if (generationError) {
            console.error('Failed to check video generations ownership:', generationError);
          }

          if (generationLink) {
            ownedByCurrentUser = true;
          }
        }
      }
      // If user is logged in, track their access to this video
      if (user) {
        await supabase
          .from('user_videos')
          .upsert({
            user_id: user.id,
            video_id: cachedVideo.id,
            accessed_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,video_id'
          });
      }

      // Ensure transcript is in merged format (backward compatibility for old cached videos)
      const originalTranscript = cachedVideo.transcript as TranscriptSegment[];
      const migratedTranscript = ensureMergedFormat(originalTranscript, {
        enableLogging: true,
        context: `YouTube ID: ${videoId}`
      });

      // Return all cached data including transcript and video info
      return NextResponse.json({
        cached: true,
        videoId: videoId,
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
        cacheDate: cachedVideo.created_at,
        ownedByCurrentUser
      });
    }

    // Video not cached
    return NextResponse.json({
      cached: false,
      videoId: videoId
    });

  } catch (error) {
    console.error('Error checking video cache:', error);
    return NextResponse.json(
      { error: 'Failed to check video cache' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
