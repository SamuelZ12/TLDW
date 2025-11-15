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

    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API configuration error' },
        { status: 500 }
      );
    }

    let transcriptSegments: any[] | null = null;
    try {
      const response = await fetch(`https://api.supadata.ai/v1/youtube/transcript?url=https://www.youtube.com/watch?v=${videoId}&lang=en`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      });

      const responseText = await response.text();
      let parsedBody: Record<string, unknown> | null = null;

      if (responseText) {
        try {
          parsedBody = JSON.parse(responseText);
        } catch {
          parsedBody = null;
        }
      }

      const combinedErrorFields = [
        typeof parsedBody?.error === 'string' ? parsedBody.error : null,
        typeof parsedBody?.message === 'string' ? parsedBody.message : null,
        typeof parsedBody?.details === 'string' ? parsedBody.details : null,
        responseText || null
      ].filter(Boolean) as string[];

      const combinedErrorMessage = combinedErrorFields.join(' ').toLowerCase();
      const hasSupadataError =
        typeof parsedBody?.error === 'string' &&
        parsedBody.error.trim().length > 0;

      const supadataStatusMessage =
        typeof parsedBody?.message === 'string' && parsedBody.message.trim().length > 0
          ? parsedBody.message.trim()
          : 'Transcript Unavailable';

      const supadataDetails =
        typeof parsedBody?.details === 'string' && parsedBody.details.trim().length > 0
          ? parsedBody.details.trim()
          : 'No transcript is available for this video.';

      const unsupportedLanguage =
        combinedErrorMessage.includes('user aborted request') ||
        combinedErrorMessage.includes('language') ||
        combinedErrorMessage.includes('unsupported transcript language');

      if (!response.ok) {
        if (response.status === 404) {
          return NextResponse.json(
            { error: 'No transcript/captions available for this video. The video may not have subtitles enabled.' },
            { status: 404 }
          );
        }

        if (unsupportedLanguage) {
          return NextResponse.json(
            {
              error: 'Unsupported transcript language',
              details: 'We currently support only YouTube videos with English transcripts. Please choose a video that has English captions enabled.'
            },
            { status: 400 }
          );
        }

        throw new Error(
          `Supadata transcript request failed (${response.status})${combinedErrorFields.length > 0 ? `: ${combinedErrorFields.join(' ')}` : ''}`
        );
      }

      if (response.status === 206 || hasSupadataError) {
        const status = unsupportedLanguage ? 400 : 404;
        const errorPayload = unsupportedLanguage
          ? {
              error: 'Unsupported transcript language',
              details: 'We currently support only YouTube videos with English transcripts. Please choose a video that has English captions enabled.'
            }
          : {
              error: supadataStatusMessage,
              details: supadataDetails
            };

        return NextResponse.json(errorPayload, { status });
      }

      const candidateContent = Array.isArray(parsedBody?.content)
        ? parsedBody?.content
        : Array.isArray(parsedBody?.transcript)
          ? parsedBody?.transcript
          : Array.isArray(parsedBody)
            ? parsedBody
            : null;

      if (!candidateContent || candidateContent.length === 0) {
        return NextResponse.json(
          {
            error: supadataStatusMessage,
            details: supadataDetails
          },
          { status: 404 }
        );
      }

      transcriptSegments = candidateContent;

      const reportedLanguages = transcriptSegments
        .map(item => {
          if (item && typeof item === 'object') {
            if (typeof (item as any).lang === 'string') return (item as any).lang;
            if (typeof (item as any).language === 'string') return (item as any).language;
          }
          return null;
        })
        .filter((lang): lang is string => typeof lang === 'string' && lang.trim().length > 0)
        .map(lang => lang.trim().toLowerCase());

      const hasReportedEnglish = reportedLanguages.some(lang => lang === 'en' || lang.startsWith('en-'));
      const hasReportedLanguages = reportedLanguages.length > 0;

      const sampleText = transcriptSegments
        .slice(0, 120)
        .map(item => {
          if (!item || typeof item !== 'object') return '';
          if (typeof (item as any).text === 'string') return (item as any).text;
          if (typeof (item as any).content === 'string') return (item as any).content;
          return '';
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const nonSpaceLength = sampleText.replace(/\s/g, '').length;
      const englishLetterCount = (sampleText.match(/[A-Za-z]/g) ?? []).length;
      const cjkCharacterPresent = /[\u3400-\u9FFF]/.test(sampleText);
      const englishRatio = nonSpaceLength > 0 ? englishLetterCount / nonSpaceLength : 0;

      const appearsNonEnglish =
        (hasReportedLanguages && !hasReportedEnglish) ||
        (cjkCharacterPresent && englishRatio < 0.2) ||
        (!hasReportedLanguages && englishRatio < 0.1 && nonSpaceLength > 0);

      if (appearsNonEnglish) {
        return NextResponse.json(
          {
            error: 'Unsupported transcript language',
            details: 'We currently support only YouTube videos with English transcripts. Please choose a video that has English captions enabled.'
          },
          { status: 400 }
        );
      }
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : '';
      if (errorMessage.includes('404')) {
        return NextResponse.json(
          { error: 'No transcript/captions available for this video. The video may not have subtitles enabled.' },
          { status: 404 }
        );
      }
      throw fetchError;
    }
    
    if (!transcriptSegments || transcriptSegments.length === 0) {
      return NextResponse.json(
        { error: 'No transcript available for this video' },
        { status: 404 }
      );
    }

    const transformedTranscript = Array.isArray(transcriptSegments) ? transcriptSegments.map((item, idx) => {
      const transformed = {
        text: item.text || item.content || '',
        // Convert milliseconds to seconds for offset/start
        start: (item.offset !== undefined ? item.offset / 1000 : item.start) || 0,
        // Convert milliseconds to seconds for duration
        duration: (item.duration !== undefined ? item.duration / 1000 : 0) || 0
      };
      
      // Check for empty segments
      if (!transformed.text || transformed.text.trim() === '') {
      }
      
      // Debug segments around index 40-46
      if (idx >= 40 && idx <= 46) {
      }
      
      return transformed;
    }) : [];
    

    return NextResponse.json({
      videoId,
      transcript: transformedTranscript
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch transcript' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
