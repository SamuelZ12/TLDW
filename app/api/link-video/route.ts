import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';

async function handler(req: NextRequest) {
  try {
    const { videoId } = await req.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Authentication is handled by the security middleware
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      // This shouldn't happen as middleware checks authentication
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      );
    }

    // Check if video exists in video_analyses table
    const { data: video, error: videoError } = await supabase
      .from('video_analyses')
      .select('id')
      .eq('youtube_id', videoId)
      .single();

    if (videoError || !video) {
      console.log('Video not found in database:', { videoId, error: videoError });
      return NextResponse.json(
        {
          error: 'Video not found in analyses',
          details: 'The video must be analyzed before it can be linked to your account',
          videoId
        },
        { status: 404 }
      );
    }

    // Check if user profile exists (required due to foreign key constraint)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      // Profile doesn't exist yet - can happen immediately after OAuth signup
      console.log('User profile not ready yet:', user.id);
      return NextResponse.json(
        {
          error: 'User profile not ready',
          message: 'Your account is being set up. Please refresh the page in a moment.',
          retryable: true
        },
        { status: 503 }
      );
    }

    // Check if video is already linked to user
    const { data: existingLink } = await supabase
      .from('user_videos')
      .select('id')
      .eq('user_id', user.id)
      .eq('video_id', video.id)
      .single();

    if (existingLink) {
      // Video is already linked, just update accessed_at silently
      await supabase
        .from('user_videos')
        .update({ accessed_at: new Date().toISOString() })
        .eq('id', existingLink.id);

      return NextResponse.json({
        success: true,
        alreadyLinked: true,
        message: 'Video already in library'
      });
    }

    // Link new video to user's account
    const { error: linkError } = await supabase
      .from('user_videos')
      .insert({
        user_id: user.id,
        video_id: video.id,
        accessed_at: new Date().toISOString()
      });

    if (linkError) {
      console.error('Error linking video to user:', {
        code: linkError.code,
        message: linkError.message,
        details: linkError.details,
        hint: linkError.hint,
        userId: user.id,
        videoId: video.id
      });
      return NextResponse.json(
        { error: 'Failed to link video to user account' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      alreadyLinked: false,
      message: 'Video successfully linked to user account'
    });

  } catch (error) {
    console.error('Error in link-video endpoint:', error);
    return NextResponse.json(
      { error: 'An error occurred while linking the video' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, {
  requireAuth: true,
  rateLimit: RATE_LIMITS.AUTH_GENERATION,
  maxBodySize: 1024 * 1024, // 1MB
  allowedMethods: ['POST']
  // CSRF protection not needed as authentication is already required
});