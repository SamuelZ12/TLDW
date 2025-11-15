import { NextRequest, NextResponse } from 'next/server';
import { TranscriptSegment, VideoInfo } from '@/lib/types';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';
import { generateWithFallback } from '@/lib/gemini-client';
import { topQuotesSchema } from '@/lib/schemas';
import { formatTranscriptWithTimestamps, formatVideoInfoBlock } from '@/lib/prompts/takeaways';

function buildTopQuotesPrompt(transcript: TranscriptSegment[], videoInfo: Partial<VideoInfo> | undefined) {
  const transcriptBlock = formatTranscriptWithTimestamps(transcript);
  const infoBlock = formatVideoInfoBlock(videoInfo);

  return `<task>
<role>You are extracting the most quotable, high-impact lines from a video transcript.</role>
<context>
${infoBlock}
</context>
<goal>Return up to five of the most compelling quotes that convey the video's main message.</goal>
<instructions>
  <item>Only use direct quotes that appear verbatim in the transcript.</item>
  <item>Each quote must highlight memorable language, strong emotion, or critical insights.</item>
  <item>Provide a short, descriptive title (max 12 words) explaining the quote's significance.</item>
  <item>Include exactly one supporting timestamp per quote, zero-padded in MM:SS or HH:MM:SS format, pointing to where the quote begins.</item>
  <item>Order the quotes from most to least impactful.</item>
</instructions>
<qualityControl>
  <item>Do not fabricate quotes or timestamps.</item>
  <item>If fewer than five strong quotes exist, return the best available and respect schema limits.</item>
</qualityControl>
<outputFormat>Return strict JSON matching the schema: [{"title":"string","quote":"string","timestamp":"MM:SS"}]</outputFormat>
<transcript><![CDATA[
${transcriptBlock}
]]></transcript>
</task>`;
}

function buildQuotesMarkdown(quotes: Array<{ title: string; quote: string; timestamp: string }>): string {
  return quotes
    .map((quote, index) => {
      const number = index + 1;
      const timestamp = `[${quote.timestamp}]`;
      return `${number}. **${quote.title}** ${timestamp}\n   > "${quote.quote}"`;
    })
    .join('\n');
}

async function handler(request: NextRequest) {
  try {
    const { transcript, videoInfo } = await request.json();

    if (!Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json({ error: 'Valid transcript is required' }, { status: 400 });
    }

    if (!videoInfo || typeof videoInfo !== 'object') {
      return NextResponse.json({ error: 'Video information is required' }, { status: 400 });
    }

    const prompt = buildTopQuotesPrompt(transcript as TranscriptSegment[], videoInfo as Partial<VideoInfo>);

    const response = await generateWithFallback(prompt, {
      zodSchema: topQuotesSchema,
      generationConfig: {
        temperature: 0.4
      }
    });

    const parsed = JSON.parse(response);
    const validation = topQuotesSchema.safeParse(parsed);

    if (!validation.success) {
      console.error('Top quotes validation failed:', validation.error.flatten());
      return NextResponse.json({ error: 'Failed to generate top quotes' }, { status: 500 });
    }

    const markdown = buildQuotesMarkdown(validation.data);

    return NextResponse.json({ quotesMarkdown: markdown, quotes: validation.data });
  } catch (error) {
    console.error('Error generating top quotes:', error);
    return NextResponse.json({ error: 'Failed to generate top quotes' }, { status: 500 });
  }
}

export const POST = withSecurity(handler, {
  rateLimit: RATE_LIMITS.AUTH_GENERATION,
  maxBodySize: 10 * 1024 * 1024,
  allowedMethods: ['POST']
});
