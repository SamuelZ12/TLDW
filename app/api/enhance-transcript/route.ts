import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProvider } from '@/lib/ai-providers';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { createClient } from '@/lib/supabase/server';
import { getUserSubscriptionStatus, getUsageStats, consumeVideoCreditAtomic } from '@/lib/subscription-manager';
import { TranscriptSegment } from '@/lib/types';

// Extend timeout for streaming
export const maxDuration = 300; // 5 minutes

const enhanceSchema = z.object({
  videoId: z.string(),
  transcript: z.array(z.object({
    start: z.number(),
    duration: z.number(),
    text: z.string(),
  })),
  videoTitle: z.string().optional(),
  channelName: z.string().optional(),
  description: z.string().optional(),
});

async function handler(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const json = await req.json();
    const parseResult = enhanceSchema.safeParse(json);

    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parseResult.error }, { status: 400 });
    }

    const { videoId, transcript, videoTitle, channelName, description } = parseResult.data;

    // Check credits
    const subscription = await getUserSubscriptionStatus(user.id, { client: supabase });
    if (!subscription) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 403 });
    }

    const stats = await getUsageStats(user.id, { client: supabase });
    if (!stats) {
      return NextResponse.json({ error: 'Could not fetch usage stats' }, { status: 500 });
    }

    // Consume 1 credit
    const creditResult = await consumeVideoCreditAtomic({
      userId: user.id,
      youtubeId: videoId,
      subscription,
      statsSnapshot: stats,
      identifier: `enhance:${videoId}:${Date.now()}`,
      counted: true, // This is a paid feature as requested
      client: supabase
    });

    if (!creditResult.success || !creditResult.allowed) {
      return NextResponse.json({
        error: creditResult.error || creditResult.reason || 'Limit reached',
        requiresTopup: creditResult.reason === 'LIMIT_REACHED' && subscription.tier === 'pro'
      }, { status: 403 });
    }

    // Prepare prompt
    const transcriptText = transcript.map(t =>
      `{"start":${t.start},"duration":${t.duration},"text":${JSON.stringify(t.text)}}`
    ).join('\n');

    const prompt = `
You are an expert video editor and transcript cleaner.
Your task is to enhance the following raw transcript from a YouTube video.

Video Details:
Title: ${videoTitle || 'Unknown'}
Channel: ${channelName || 'Unknown'}
Description: ${description ? description.slice(0, 500) : 'None'}

Instructions:
1. Fix grammar, punctuation, and capitalization.
2. Remove filler words (um, uh, like, you know) unless they add meaning.
3. Identify speakers if possible (e.g., "Speaker A", "Speaker B", or actual names if inferred from context). Add a "speaker" field.
4. Keep the "start" and "duration" fields exactly as they are for synchronization.
5. Output MUST be in NDJSON format (New-Line Delimited JSON). Each line must be a valid JSON object.
6. Do NOT output markdown code blocks. Just the raw NDJSON lines.
7. Ensure every input segment has a corresponding output segment. Do not merge or split segments significantly to preserve timestamp alignment.

Input Transcript (NDJSON):
${transcriptText}
`;

    const provider = getProvider('gemini');

    if (!provider.generateStream) {
      return NextResponse.json({ error: 'Streaming not supported by current provider' }, { status: 501 });
    }

    const stream = await provider.generateStream({
      prompt,
      temperature: 0.3, // Low temperature for accuracy
    });

    // Create a TransformStream to:
    // 1. Pass through data to the client
    // 2. Accumulate data for persistence
    const te = new TextEncoder();
    const td = new TextDecoder();
    let accumulatedText = '';

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = td.decode(chunk);
        accumulatedText += text;
        controller.enqueue(chunk);
      },
      async flush() {
        // Persistence Logic
        try {
          // Parse accumulated NDJSON
          const lines = accumulatedText.trim().split('\n');
          const enhancedTranscript: TranscriptSegment[] = [];

          for (const line of lines) {
            try {
              if (line.trim()) {
                const parsed = JSON.parse(line.trim());
                // Validate parsed object matches structure
                if (typeof parsed.start === 'number' && typeof parsed.text === 'string') {
                  enhancedTranscript.push(parsed);
                }
              }
            } catch (e) {
              console.warn('Failed to parse NDJSON line during persistence:', line);
            }
          }

          if (enhancedTranscript.length > 0) {
            // Update database
            // We update the shared analysis for this videoId.
            // Since the user spent a credit, it's fair to improve the global record.
             const { error } = await supabase
              .from('video_analyses')
              .update({ transcript: enhancedTranscript as any }) // using as any because Supabase types might be strict about JSON
              .eq('youtube_id', videoId);

             if (error) {
               console.error('Failed to update enhanced transcript in DB:', error);
             }
          }
        } catch (err) {
          console.error('Error persisting enhanced transcript:', err);
        }
      }
    });

    return new NextResponse(stream.pipeThrough(transformStream), {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error) {
    console.error('Enhance transcript error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.USER_ONLY);
