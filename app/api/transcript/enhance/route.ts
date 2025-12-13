import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { generateAIResponse } from '@/lib/ai-client';
import {
  consumeVideoCreditAtomic,
  canGenerateVideo,
  getUserSubscriptionStatus,
  getUsageStats,
} from '@/lib/subscription-manager';
import { youtubeIdSchema, transcriptSchema, videoInfoSchema } from '@/lib/validation';

// Define the request schema for validation
const enhanceTranscriptSchema = z.object({
  videoId: youtubeIdSchema,
  videoInfo: videoInfoSchema,
  transcript: transcriptSchema,
});

// Define the response schema from AI to ensure strict JSON output
const aiResponseSchema = z.object({
  enhancedSegments: z.array(z.string()),
});

async function handler(req: NextRequest) {
  try {
    const body = await req.json();

    // 1. Validate request body
    const result = enhanceTranscriptSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: result.error.format() },
        { status: 400 }
      );
    }

    const { videoId, videoInfo, transcript } = result.data;
    const supabase = await createClient();

    // 2. Get user info
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 3. Check credits (using canGenerateVideo to mimic standard checks,
    // but we force a credit consumption regardless of cache since this is a new "action")
    // Wait, if we use canGenerateVideo with youtubeId, it might say "CACHED" and free.
    // But "Enhance" is a new paid action.
    // So we should check if they have remaining credits directly, ignoring the cache status of the video itself.
    // Or we can pass skipCacheCheck: true
    const decision = await canGenerateVideo(user.id, videoId, {
      client: supabase,
      skipCacheCheck: true
    });

    if (!decision.allowed) {
        return NextResponse.json(
            { error: decision.reason || 'Insufficient credits' },
            { status: 403 }
        );
    }

    // 4. Prepare AI Prompt
    // We only send text to save context window and complexity.
    const rawTexts = transcript.map(s => s.text);
    const systemPrompt = `
You are an expert transcript editor. Your task is to enhance the accuracy and readability of a video transcript while maintaining a strict 1:1 mapping with the input segments.

Context:
- Video Title: "${videoInfo.title}"
- Channel/Author: "${videoInfo.author || 'Unknown'}"
- Description: "${videoInfo.description?.slice(0, 500) || 'N/A'}"

Instructions:
1.  Read the input array of strings. Each string corresponds to a specific time segment.
2.  Clean up filler words (um, uh, like, etc.), fix grammar, punctuation, and capitalization.
3.  Fix specific terms based on context (e.g., technical terms, proper nouns).
4.  Identify speakers if clear from context, but prioritize flow and readability.
5.  **CRITICAL:** You MUST return an array of strings called "enhancedSegments".
6.  **CRITICAL:** The "enhancedSegments" array MUST have exactly the same length as the input array. Index 0 of output must correspond to Index 0 of input.
7.  Do not merge or split segments across indices. If a sentence spans multiple segments, ensure the split points remain roughly the same or flow naturally across the boundary.

Input Segments:
${JSON.stringify(rawTexts)}
`;

    // 5. Call AI
    const aiResponse = await generateAIResponse(systemPrompt, {
      model: 'grok-4-1-fast-non-reasoning', // As requested
      zodSchema: aiResponseSchema,
      schemaName: 'EnhancedTranscript',
      temperature: 0.2 // Low temperature for consistent formatting
    });

    // 6. Parse and Validate AI Response
    let enhancedTexts: string[] = [];
    try {
        const parsed = JSON.parse(aiResponse);
        // Handle case where it might be wrapped in another object or just the object itself
        if (parsed.enhancedSegments && Array.isArray(parsed.enhancedSegments)) {
            enhancedTexts = parsed.enhancedSegments;
        } else {
            throw new Error('Invalid JSON structure');
        }
    } catch (e) {
        console.error('AI response parsing failed:', e, aiResponse);
        return NextResponse.json(
            { error: 'AI failed to generate valid JSON' },
            { status: 502 }
        );
    }

    if (enhancedTexts.length !== transcript.length) {
        console.error(`Segment count mismatch: Input ${transcript.length}, Output ${enhancedTexts.length}`);
         return NextResponse.json(
            { error: 'AI generated transcript length mismatch' },
            { status: 502 }
        );
    }

    // 7. Reconstruct Transcript
    const enhancedTranscript = transcript.map((segment, idx) => ({
        ...segment,
        text: enhancedTexts[idx]
    }));

    // 8. Consume Credit Atomic
    // We need to fetch stats again for the snapshot required by consumeVideoCreditAtomic
    // (Or rely on the ones from decision if they are fresh enough, but safer to re-fetch or use decision.stats if available)
    if (!decision.subscription || !decision.stats) {
         return NextResponse.json(
            { error: 'Failed to retrieve subscription info' },
            { status: 500 }
        );
    }

    const consumption = await consumeVideoCreditAtomic({
        userId: user.id,
        youtubeId: videoId,
        subscription: decision.subscription,
        statsSnapshot: decision.stats,
        counted: true,
        identifier: `enhance:${videoId}:${Date.now()}`,
        client: supabase
    });

    if (!consumption.success) {
        return NextResponse.json(
            { error: consumption.reason || 'Failed to consume credit' },
            { status: 500 }
        );
    }

    // 9. Update Database
    const { error: updateError } = await supabase
        .from('video_analyses')
        .update({ transcript: enhancedTranscript })
        .eq('youtube_id', videoId);

    if (updateError) {
        console.error('Failed to update transcript in DB:', updateError);
        // Note: Credit was already consumed. In a production system, we might want to rollback or flag this.
        // For now, we log it.
         return NextResponse.json(
            { error: 'Failed to save enhanced transcript' },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        transcript: enhancedTranscript
    });

  } catch (error) {
    console.error('Enhance transcript error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.STRICT);
