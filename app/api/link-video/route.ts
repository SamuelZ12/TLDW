import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
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
      return NextResponse.json(
        { error: 'Video not found in analyses' },
        { status: 404 }
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
      console.error('Error linking video to user:', linkError);
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