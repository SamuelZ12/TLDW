import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/utils';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';

async function handler(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'YouTube URL is required' },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    // Try Supadata API first for richer metadata including description
    const apiKey = process.env.SUPADATA_API_KEY;

    if (apiKey) {
      try {
        const supadataUrl = `https://api.supadata.ai/v1/youtube/video?id=${videoId}`;

        const supadataResponse = await fetch(supadataUrl, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        });

        if (supadataResponse.ok) {
          const supadataData = await supadataResponse.json();

          // Extract video metadata from Supadata response
          return NextResponse.json({
            videoId,
            title: supadataData.title || 'YouTube Video',
            author: supadataData.channel?.name || supadataData.author || 'Unknown',
            thumbnail: supadataData.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            duration: supadataData.duration || null,
            description: supadataData.description || undefined,
            tags: supadataData.tags || supadataData.keywords || undefined
          });
        }
      } catch (supadataError) {
        // Fall through to oEmbed if Supadata fails
        console.error('[VIDEO-INFO] Supadata API error:', {
          error: supadataError,
          message: (supadataError as Error).message,
          stack: (supadataError as Error).stack
        });
      }
    }

    // Fallback to YouTube oEmbed API (no API key required)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    try {
      const response = await fetch(oembedUrl);

      if (!response.ok) {
        // Return minimal info if oEmbed fails
        return NextResponse.json({
          videoId,
          title: 'YouTube Video',
          author: 'Unknown',
          thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          duration: null
        });
      }

      const data = await response.json();

      return NextResponse.json({
        videoId,
        title: data.title || 'YouTube Video',
        author: data.author_name || 'Unknown',
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: null // oEmbed doesn't provide duration or description
      });

    } catch (fetchError) {
      // Return minimal info on error
      return NextResponse.json({
        videoId,
        title: 'YouTube Video',
        author: 'Unknown',
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: null
      });
    }
    
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch video information' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);