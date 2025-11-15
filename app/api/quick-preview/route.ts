import { NextRequest, NextResponse } from 'next/server';
import { TranscriptSegment } from '@/lib/types';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { generateWithFallback } from '@/lib/gemini-client';
import { quickPreviewSchema } from '@/lib/schemas';

function buildFallbackPreview(options: {
  videoTitle?: string;
  channelName?: string;
  videoDescription?: string;
}) {
  const { videoTitle, channelName, videoDescription } = options;

  if (videoDescription && videoDescription.trim().length > 0) {
    const excerpt = videoDescription.trim().split(/\s+/).slice(0, 40).join(' ');
    const prefix = videoTitle ? `Preview of "${videoTitle}":` : 'Preview:';
    return `${prefix} ${excerpt}${excerpt.endsWith('.') ? '' : '...'}`;
  }

  if (videoTitle && channelName) {
    return `${channelName} digs into "${videoTitle}". We’re surfacing the key ideas for you...`;
  }

  if (videoTitle) {
    return `Analyzing "${videoTitle}" to capture the standout moments and takeaways...`;
  }

  if (channelName) {
    return `Exploring the latest from ${channelName}. Highlights coming together...`;
  }

  return 'Analyzing this video to surface the big ideas and timestamps...';
}

async function handler(request: NextRequest) {
  try {
    const { transcript, videoTitle, videoDescription, channelName, tags } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Transcript is required' },
        { status: 400 }
      );
    }

    // Take first ~30 seconds or 500 words of transcript for quick preview
    let previewText = '';
    let wordCount = 0;
    const maxWords = 500;
    const maxTime = 30; // seconds

    const segments = transcript as TranscriptSegment[];
    const baseStart = segments.length > 0 ? segments[0].start : 0;

    for (const segment of segments) {
      const relativeStart = Math.max(0, segment.start - baseStart);
      if (relativeStart > maxTime && previewText.trim().length > 0) {
        break;
      }

      const words = segment.text.split(' ');
      if (wordCount + words.length > maxWords) {
        const remainingWords = maxWords - wordCount;
        previewText += ' ' + words.slice(0, remainingWords).join(' ');
        break;
      }
      
      previewText += ' ' + segment.text;
      wordCount += words.length;
    }

    const trimmedPreview = previewText.trim();
    const metadataFallback = buildFallbackPreview({
      videoTitle,
      channelName,
      videoDescription
    });

    if (!trimmedPreview) {
      return NextResponse.json({ 
        preview: metadataFallback
      });
    }

    const prompt = `<task>
<role>You are an expert content editor writing a fast, engaging preview for a video.</role>
<context>
<metadata>
${videoTitle ? `Title: ${videoTitle}` : 'Title: Unknown'}
${channelName ? `\nChannel: ${channelName}` : ''}
${tags && tags.length > 0 ? `\nTags: ${tags.join(', ')}` : ''}
${videoDescription ? `\nDescription: ${videoDescription}` : ''}
</metadata>
</context>
<goal>Craft a 3-4 sentence overview that convinces a curious viewer to watch.</goal>
<instructions>
  <item>Highlight the speaker's credibility or background when possible.</item>
  <item>State the central topic or tension clearly in the first sentence.</item>
  <item>Preview the most compelling argument, story, or takeaway without spoiling everything.</item>
  <item>Maintain an energetic but professional tone.</item>
</instructions>
<outputFormat>Return strict JSON object: {"overview":"string"} with no additional text.</outputFormat>
<transcriptExcerpt><![CDATA[
${trimmedPreview}
]]></transcriptExcerpt>
</task>`;

    let preview: string | undefined;

    try {
      const response = await generateWithFallback(prompt, {
        generationConfig: {
          temperature: 0.7
        },
        zodSchema: quickPreviewSchema
      });
      if (response) {
        const parsed = quickPreviewSchema.parse(JSON.parse(response));
        preview = parsed.overview.trim();
      }
    } catch (aiError: any) {
      console.error('AI model error:', aiError);
      preview = undefined;
    }

    if (preview) {
      return NextResponse.json({ preview });
    }

    return NextResponse.json({
      preview: metadataFallback
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
