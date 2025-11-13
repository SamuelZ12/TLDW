import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/utils';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { shouldUseMockData, getMockTranscript } from '@/lib/mock-data';
import { mergeTranscriptSegmentsIntoSentences } from '@/lib/transcript-sentence-merger';
import { NO_CREDITS_USED_MESSAGE } from '@/lib/no-credits-message';

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

async function handler(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return respondWithNoCredits({ error: 'YouTube URL is required' }, 400);
    }

    const videoId = extractVideoId(url);

    if (!videoId) {
      return respondWithNoCredits({ error: 'Invalid YouTube URL' }, 400);
    }

    if (shouldUseMockData()) {
      console.log(
        '[TRANSCRIPT] Using mock data (NEXT_PUBLIC_USE_MOCK_DATA=true)'
      );
      const mockData = getMockTranscript(videoId);

      const rawSegments = mockData.content.map((item: any) => ({
        text: item.text,
        start: item.offset / 1000, // Convert milliseconds to seconds
        duration: item.duration / 1000 // Convert milliseconds to seconds
      }));

      // Merge segments into complete sentences for better translation
      const mergedSentences = mergeTranscriptSegmentsIntoSentences(rawSegments);
      const transformedTranscript = mergedSentences.map((sentence) => ({
        text: sentence.text,
        start: sentence.segments[0].start, // Use first segment's start time
        duration: sentence.segments.reduce((sum, seg) => sum + seg.duration, 0) // Sum all durations
      }));

      return NextResponse.json({
        videoId,
        transcript: transformedTranscript
      });
    }

    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) {
      return respondWithNoCredits({ error: 'API configuration error' }, 500);
    }

    let transcriptSegments: any[] | null = null;
    try {
      const response = await fetch(
        `https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v=${videoId}&lang=en`,
        {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

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
        typeof parsedBody?.message === 'string' &&
        parsedBody.message.trim().length > 0
          ? parsedBody.message.trim()
          : 'Transcript Unavailable';

      const supadataDetails =
        typeof parsedBody?.details === 'string' &&
        parsedBody.details.trim().length > 0
          ? parsedBody.details.trim()
          : 'No transcript is available for this video.';

      const unsupportedLanguage =
        combinedErrorMessage.includes('user aborted request') ||
        combinedErrorMessage.includes('language') ||
        combinedErrorMessage.includes('unsupported transcript language');

      if (!response.ok) {
        if (response.status === 404) {
          return respondWithNoCredits(
            {
              error:
                'No transcript/captions available for this video. The video may not have subtitles enabled.'
            },
            404
          );
        }

        if (unsupportedLanguage) {
          return respondWithNoCredits(
            {
              error: 'Unsupported transcript language',
              details:
                'We currently support only YouTube videos with English transcripts. Please choose a video that has English captions enabled.'
            },
            400
          );
        }

        throw new Error(
          `Supadata transcript request failed (${response.status})${
            combinedErrorFields.length > 0
              ? `: ${combinedErrorFields.join(' ')}`
              : ''
          }`
        );
      }

      if (response.status === 206 || hasSupadataError) {
        const status = unsupportedLanguage ? 400 : 404;
        const errorPayload = unsupportedLanguage
          ? {
              error: 'Unsupported transcript language',
              details:
                'We currently support only YouTube videos with English transcripts. Please choose a video that has English captions enabled.'
            }
          : {
              error: supadataStatusMessage,
              details: supadataDetails
            };

        return respondWithNoCredits(errorPayload, status);
      }

      const candidateContent = Array.isArray(parsedBody?.content)
        ? parsedBody?.content
        : Array.isArray(parsedBody?.transcript)
        ? parsedBody?.transcript
        : Array.isArray(parsedBody)
        ? parsedBody
        : null;

      if (!candidateContent || candidateContent.length === 0) {
        return respondWithNoCredits(
          {
            error: supadataStatusMessage,
            details: supadataDetails
          },
          404
        );
      }

      transcriptSegments = candidateContent;

      const reportedLanguages = transcriptSegments
        .map((item) => {
          if (item && typeof item === 'object') {
            if (typeof (item as any).lang === 'string')
              return (item as any).lang;
            if (typeof (item as any).language === 'string')
              return (item as any).language;
          }
          return null;
        })
        .filter(
          (lang): lang is string =>
            typeof lang === 'string' && lang.trim().length > 0
        )
        .map((lang) => lang.trim().toLowerCase());

      const hasReportedEnglish = reportedLanguages.some(
        (lang) => lang === 'en' || lang.startsWith('en-')
      );
      const hasReportedLanguages = reportedLanguages.length > 0;

      const sampleText = transcriptSegments
        .slice(0, 120)
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          if (typeof (item as any).text === 'string') return (item as any).text;
          if (typeof (item as any).content === 'string')
            return (item as any).content;
          return '';
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const nonSpaceLength = sampleText.replace(/\s/g, '').length;
      const englishLetterCount = (sampleText.match(/[A-Za-z]/g) ?? []).length;
      const cjkCharacterPresent = /[\u3400-\u9FFF]/.test(sampleText);
      const englishRatio =
        nonSpaceLength > 0 ? englishLetterCount / nonSpaceLength : 0;

      const appearsNonEnglish =
        (hasReportedLanguages && !hasReportedEnglish) ||
        (cjkCharacterPresent && englishRatio < 0.2) ||
        (!hasReportedLanguages && englishRatio < 0.1 && nonSpaceLength > 0);

      if (appearsNonEnglish) {
        return respondWithNoCredits(
          {
            error: 'Unsupported transcript language',
            details:
              'We currently support only YouTube videos with English transcripts. Please choose a video that has English captions enabled.'
          },
          400
        );
      }
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : '';
      if (errorMessage.includes('404')) {
        return respondWithNoCredits(
          {
            error:
              'No transcript/captions available for this video. The video may not have subtitles enabled.'
          },
          404
        );
      }
      throw fetchError;
    }

    if (!transcriptSegments || transcriptSegments.length === 0) {
      return respondWithNoCredits(
        { error: 'No transcript available for this video' },
        404
      );
    }

    const rawSegments = Array.isArray(transcriptSegments)
      ? transcriptSegments.map((item, idx) => {
          const transformed = {
            text: item.text || item.content || '',
            // Convert milliseconds to seconds for offset/start
            start:
              (item.offset !== undefined ? item.offset / 1000 : item.start) ||
              0,
            // Convert milliseconds to seconds for duration
            duration:
              (item.duration !== undefined ? item.duration / 1000 : 0) || 0
          };

          return transformed;
        })
      : [];

    // Merge segments into complete sentences for better translation
    const mergedSentences = mergeTranscriptSegmentsIntoSentences(rawSegments);
    const transformedTranscript = mergedSentences.map((sentence) => ({
      text: sentence.text,
      start: sentence.segments[0].start, // Use first segment's start time
      duration: sentence.segments.reduce((sum, seg) => sum + seg.duration, 0) // Sum all durations
    }));

    return NextResponse.json({
      videoId,
      transcript: transformedTranscript
    });
  } catch (error) {
    console.error('[TRANSCRIPT] Error processing transcript:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error?.constructor?.name
    });
    return respondWithNoCredits({ error: 'Failed to fetch transcript' }, 500);
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
