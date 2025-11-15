import { NextRequest, NextResponse } from 'next/server';
import { TranscriptSegment, VideoInfo } from '@/lib/types';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';
import { generateWithFallback } from '@/lib/gemini-client';
import { summaryTakeawaysSchema } from '@/lib/schemas';
import { normalizeTimestampSources } from '@/lib/timestamp-normalization';
import { buildTakeawaysPrompt } from '@/lib/prompts/takeaways';

type StructuredTakeaway = {
  label: string;
  insight: string;
  timestamps: string[];
};

const TAKEAWAYS_HEADING = '## Key takeaways';

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }

  return trimmed;
}

function normalizeTakeawaysPayload(payload: unknown): StructuredTakeaway[] {
  const candidateArray = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.takeaways)
      ? (payload as any).takeaways
      : Array.isArray((payload as any)?.items)
        ? (payload as any).items
        : [];

  const normalized: StructuredTakeaway[] = [];

  for (const item of candidateArray) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawLabel = typeof (item as any).label === 'string'
      ? (item as any).label
      : typeof (item as any).title === 'string'
        ? (item as any).title
        : '';

    const rawInsight = typeof (item as any).insight === 'string'
      ? (item as any).insight
      : typeof (item as any).summary === 'string'
        ? (item as any).summary
        : typeof (item as any).description === 'string'
          ? (item as any).description
          : '';

    const timestampSources: unknown[] = [];

    if (Array.isArray((item as any).timestamps)) {
      timestampSources.push(...(item as any).timestamps);
    }

    if (typeof (item as any).timestamp === 'string') {
      timestampSources.push((item as any).timestamp);
    }

    if (typeof (item as any).time === 'string') {
      timestampSources.push((item as any).time);
    }

    const uniqueTimestamps = normalizeTimestampSources(timestampSources, { limit: 2 });

    const label = rawLabel.trim();
    const insight = rawInsight.trim();

    if (!label || !insight || uniqueTimestamps.length === 0) {
      continue;
    }

    normalized.push({
      label,
      insight,
      timestamps: uniqueTimestamps
    });

    if (normalized.length === 6) {
      break;
    }
  }

  return normalized;
}

function buildTakeawaysMarkdown(takeaways: StructuredTakeaway[]): string {
  const lines = [TAKEAWAYS_HEADING];

  for (const item of takeaways) {
    const label = item.label.trim().replace(/\s+/g, ' ');
    const insight = item.insight.trim();
    const timestampItems = item.timestamps
      .map(ts => ts.trim())
      .filter(Boolean)
      .map(ts => `[${ts}]`);

    const timestampSuffix = timestampItems.length > 0
      ? ` ${timestampItems.join(', ')}`
      : '';
    lines.push(`- **${label}**: ${insight}${timestampSuffix}`);
  }

  return lines.join('\n');
}

async function handler(request: NextRequest) {
  try {
    const { transcript, videoInfo } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }

    if (!videoInfo || !videoInfo.title) {
      return NextResponse.json(
        { error: 'Video information is required' },
        { status: 400 }
      );
    }

    const prompt = buildTakeawaysPrompt({
      transcript: transcript as TranscriptSegment[],
      videoInfo: videoInfo as Partial<VideoInfo>
    });

    let response: string;

    try {
      response = await generateWithFallback(prompt, {
        generationConfig: {
          temperature: 0.6
        },
        zodSchema: summaryTakeawaysSchema
      });
    } catch (error) {
      console.error('Error generating summary:', error);
      throw new Error('No response from AI model');
    }

    if (!response) {
      throw new Error('No response from AI model');
    }

    let takeaways: StructuredTakeaway[];
    try {
      const cleanedResponse = extractJsonPayload(response);
      const parsed = JSON.parse(cleanedResponse);
      const normalized = normalizeTakeawaysPayload(parsed);

      const validation = summaryTakeawaysSchema.safeParse(normalized);
      if (!validation.success) {
        console.error('Normalized takeaways failed validation:', validation.error.flatten());
        throw new Error('Normalized takeaways did not match expected schema');
      }

      takeaways = validation.data as StructuredTakeaway[];
    } catch (parseError) {
      console.error('Failed to parse summary response:', parseError);
      throw new Error('Invalid response format from AI model');
    }

    if (!takeaways.length) {
      throw new Error('AI model returned no takeaways');
    }

    const markdown = buildTakeawaysMarkdown(takeaways);

    return NextResponse.json({ summaryContent: markdown });
  } catch (error) {
    console.error('Error generating summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

// Apply security with generation rate limits
export const POST = withSecurity(handler, {
  rateLimit: RATE_LIMITS.AUTH_GENERATION, // Use authenticated rate limit
  maxBodySize: 10 * 1024 * 1024, // 10MB for large transcripts
  allowedMethods: ['POST']
});
