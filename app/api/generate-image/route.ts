import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { transcriptSchema } from '@/lib/validation';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { hasUnlimitedVideoAllowance } from '@/lib/access-control';
import {
  canGenerateImage,
  consumeImageCreditAtomic,
  IMAGE_TIER_LIMITS,
} from '@/lib/image-generation-manager';
import { TranscriptSegment } from '@/lib/types';

const requestSchema = z.object({
  videoId: z.string().min(5),
  transcript: transcriptSchema,
  videoTitle: z.string().optional(),
});

const DEFAULT_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-3-pro-image-preview';

function transcriptToPlainText(transcript: TranscriptSegment[]): string {
  return transcript
    .map((segment) => segment.text?.trim() || '')
    .filter(Boolean)
    .join('\n');
}

function buildPrompt(transcript: TranscriptSegment[]): string {
  const transcriptText = transcriptToPlainText(transcript);
  return [
    'Generate an image. Turn this transcript into a cheatsheet with key takeaways, and give final output as 9:16 image created by nano banana.',
    '',
    transcriptText,
  ].join('\n');
}

async function callGeminiImageAPI(prompt: string, model: string, apiKey: string) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '9:16',
          imageSize: '1K',
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini image API error (${response.status}): ${
        errorText || 'unknown error'
      }`
    );
  }

  const data = await response.json();
  const parts =
    data?.candidates?.[0]?.content?.parts ??
    data?.contents?.[0]?.parts ??
    [];

  const imagePart = parts.find(
    (part: any) => part?.inlineData?.data || part?.inline_data?.data
  );

  if (!imagePart) {
    throw new Error('Gemini returned no image data');
  }

  const inlineData = imagePart.inlineData ?? imagePart.inline_data;
  const mimeType = inlineData?.mimeType ?? 'image/png';
  const base64Data = inlineData?.data;

  if (!base64Data) {
    throw new Error('Gemini image payload was empty');
  }

  const imageUrl = `data:${mimeType};base64,${base64Data}`;

  return {
    imageUrl,
  };
}

async function handler(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { videoId, transcript } = parsed.data;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: 'Sign in to generate images',
          message:
            'Create a free account to get 5 image generations per month, or upgrade to Pro for 100 per month.',
          requiresAuth: true,
        },
        { status: 401 }
      );
    }

    const unlimited = hasUnlimitedVideoAllowance(user);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API key missing. Set GEMINI_API_KEY.' },
        { status: 500 }
      );
    }

    // Enforce quota for non-whitelisted users
    const generationDecision = unlimited
      ? { allowed: true, reason: 'OK', stats: null, subscription: null }
      : await canGenerateImage(user.id, { client: supabase });

    if (!generationDecision.allowed) {
      const tier = generationDecision.subscription?.tier ?? 'free';
      const stats = generationDecision.stats;
      const resetAt =
        stats?.resetAt ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      return NextResponse.json(
        {
          error: 'Monthly image limit reached',
          message:
            tier === 'free'
              ? "You've used your 5 free image generations this month. Upgrade to Pro for 100 per month."
              : 'You have used your Pro allowance. Please wait for your next billing cycle to reset.',
          tier,
          remaining: stats?.baseRemaining ?? 0,
          resetAt,
          reason: generationDecision.reason,
        },
        { status: 429 }
      );
    }

    const prompt = buildPrompt(transcript);
    const modelUsed = DEFAULT_IMAGE_MODEL;

    const { imageUrl } = await callGeminiImageAPI(
      prompt,
      modelUsed,
      apiKey
    );

    // Consume credit after successful generation (unless unlimited)
    if (!unlimited && generationDecision.subscription && generationDecision.stats) {
      const consumeResult = await consumeImageCreditAtomic({
        userId: user.id,
        youtubeId: videoId,
        subscription: generationDecision.subscription,
        statsSnapshot: generationDecision.stats,
        videoAnalysisId: null,
        counted: true,
        client: supabase,
      });

      if (!consumeResult.success) {
        console.warn('Failed to record image generation:', consumeResult.error);
      }
    }

    const remaining =
      unlimited || !generationDecision.stats
        ? null
        : Math.max(0, generationDecision.stats.baseRemaining - 1);

    return NextResponse.json({
      imageUrl,
      modelUsed,
      remaining,
      limit: generationDecision.stats
        ? generationDecision.stats.baseLimit
        : IMAGE_TIER_LIMITS.free,
    });
  } catch (error) {
    console.error('Error generating image:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate image',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, {
  ...SECURITY_PRESETS.PUBLIC,
  maxBodySize: 3 * 1024 * 1024, // transcripts can be large
});
