import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/utils';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { getMockVideoInfo, shouldUseMockVideoInfo } from '@/lib/mock-data';

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

    // Use mock data if enabled (for development when Supadata is rate-limited)
    if (shouldUseMockVideoInfo()) {
      console.log(
        '[VIDEO-INFO] Using mock data (NEXT_PUBLIC_USE_MOCK_VIDEO_INFO=true)'
      );
      const mockData = getMockVideoInfo(videoId);
      return NextResponse.json({
        videoId,
        title: mockData.title,
        author: mockData.channel.name,
        thumbnail: mockData.thumbnail,
        duration: mockData.duration,
        description: mockData.description,
        tags: mockData.tags
      });
    }

    // Try Supadata API first for richer metadata including description
    const apiKey = process.env.SUPADATA_API_KEY;

    if (apiKey) {
      try {
        const supadataResponse = await fetch(
          `https://api.supadata.ai/v1/youtube/video?id=${videoId}`,
          {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json'
            }
          }
        );

        if (supadataResponse.ok) {
          const supadataData = await supadataResponse.json();

          // Extract video metadata from Supadata response
          // Ensure duration is always a number (default to 0 if not available)
          const duration =
            typeof supadataData.duration === 'number'
              ? supadataData.duration
              : 0;

          return NextResponse.json({
            videoId,
            title: supadataData.title || 'YouTube Video',
            author:
              supadataData.channel?.name || supadataData.author || 'Unknown',
            thumbnail:
              supadataData.thumbnail ||
              `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            duration,
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
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );

      if (!response.ok) {
        // Return minimal info if oEmbed fails
        return NextResponse.json({
          videoId,
          title: 'YouTube Video',
          author: 'Unknown',
          thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          duration: 0 // Default to 0 instead of null
        });
      }

      const data = await response.json();

      return NextResponse.json({
        videoId,
        title: data.title || 'YouTube Video',
        author: data.author_name || 'Unknown',
        thumbnail:
          data.thumbnail_url ||
          `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: 0 // oEmbed doesn't provide duration - default to 0
      });
    } catch (fetchError) {
      console.error('[VIDEO-INFO] oEmbed fetch error:', fetchError);
      // Return minimal info on error
      return NextResponse.json({
        videoId,
        title: 'YouTube Video',
        author: 'Unknown',
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration: 0 // Default to 0 instead of null
      });
    }
  } catch (error) {
    console.error('[VIDEO-INFO] Top-level error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json(
      { error: 'Failed to fetch video information' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
