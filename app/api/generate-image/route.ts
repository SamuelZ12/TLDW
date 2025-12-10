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
  videoAuthor: z.string().optional(),
  aspectRatio: z
    .enum(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'])
    .default('9:16'),
  style: z
    .enum([
      'neo-brutalism',
      'glass',
      'vintage-revival-editorial',
      'dark-mode-botanical',
    ])
    .default('neo-brutalism'),
});

type AspectRatio = z.infer<typeof requestSchema>['aspectRatio'];
type ImageStyle = z.infer<typeof requestSchema>['style'];

const DEFAULT_IMAGE_SIZE = '1K' as const;

const IMAGE_STYLE_PROMPTS: Record<ImageStyle, { label: string; prompt: string }> = {
  'neo-brutalism': {
    label: 'Neo-Brutalism',
    prompt:
      'Use heavy ~3px black outlines around every container, hard black offset shadows (no blur), an off-white canvas with blocks of mustard yellow, cornflower blue, and seafoam green. Headings are heavy, all-caps geometric sans. Buttons and cards are sharp rectangles with raw, functional presence.',
  },
  glass: {
    label: 'Glass',
    prompt:
      'Photorealistic futuristic glassmorphism: a transparent bezel-less handheld device in a realistic hand, dramatic low-key lighting on a black void. Neon rim light magenta-to-amber, crisp sans UI showing video title and channel, insights/takeaways readable beneath. The device glow should light the fingers.',
  },
  'vintage-revival-editorial': {
    label: 'Vintage-Revival Editorial',
    prompt:
      'Warm cream paper background with soft charcoal ink, subtle film grain. Typography is high-contrast serif (Editorial New vibe), centered tight-kerning Title Case headlines for an authoritative editorial look.',
  },
  'dark-mode-botanical': {
    label: 'Dark Mode Botanical',
    prompt:
      'True black backdrop with crisp white/grey monospaced text laid out like a code grid. Accents of dusty rose, cream, sage green, burnished gold in an embroidered/tapestry floral motif anchored bottom-left. Tech-noir meets cottagecore: lots of negative space, raw neo-brutalist layout balance.',
  },
};

const DEFAULT_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-3-pro-image-preview';

const FREE_IMAGE_LIMIT = IMAGE_TIER_LIMITS.free;
const PRO_IMAGE_LIMIT = IMAGE_TIER_LIMITS.pro;

function transcriptToPlainText(transcript: TranscriptSegment[]): string {
  return transcript
    .map((segment) => segment.text?.trim() || '')
    .filter(Boolean)
    .join('\n');
}

function buildPrompt(
  transcript: TranscriptSegment[],
  videoTitle: string | undefined,
  videoAuthor: string | undefined,
  style: ImageStyle,
  aspectRatio: AspectRatio
): string {
  const transcriptText = transcriptToPlainText(transcript);
  const context = [];

  if (videoTitle) context.push(`Video: "${videoTitle}"`);
  if (videoAuthor) context.push(`Channel: ${videoAuthor}`);

  const stylePreset = IMAGE_STYLE_PROMPTS[style] ?? IMAGE_STYLE_PROMPTS['neo-brutalism'];
  const dimensionNote = `Target aspect ratio ${aspectRatio}.`;

  return [
    'Generate a highly shareable social media infographic based on this YouTube video transcript, summarizing the top insights and takeaways.',
    'Include the video title and channel name in the graphics. In a corner of the image, include the elegant label "Made with longcut.ai".',
    dimensionNote,
    `Apply the "${stylePreset.label}" style: ${stylePreset.prompt}`,
    ...context,
    '',
    transcriptText,
  ].join('\n');
}

async function callGeminiImageAPI(
  prompt: string,
  model: string,
  apiKey: string,
  aspectRatio: AspectRatio
) {
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
          aspectRatio,
          imageSize: DEFAULT_IMAGE_SIZE,
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

    const {
      videoId,
      transcript,
      videoTitle,
      videoAuthor,
      aspectRatio,
      style,
    } = parsed.data;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: 'Sign in to generate images',
          message:
            `Create a free account to get ${FREE_IMAGE_LIMIT} image generation${FREE_IMAGE_LIMIT === 1 ? '' : 's'} per month, or upgrade to Pro for ${PRO_IMAGE_LIMIT} per month.`,
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
              ? `You've used your ${FREE_IMAGE_LIMIT} free image generation${FREE_IMAGE_LIMIT === 1 ? '' : 's'} this month. Upgrade to Pro for ${PRO_IMAGE_LIMIT} per month.`
              : 'You have used your Pro allowance. Please wait for your next billing cycle to reset.',
          tier,
          remaining: stats?.baseRemaining ?? 0,
          resetAt,
          reason: generationDecision.reason,
        },
        { status: 429 }
      );
    }

    const prompt = buildPrompt(
      transcript,
      videoTitle,
      videoAuthor,
      style,
      aspectRatio
    );
    const modelUsed = DEFAULT_IMAGE_MODEL;

    const { imageUrl } = await callGeminiImageAPI(
      prompt,
      modelUsed,
      apiKey,
      aspectRatio
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
      aspectRatio,
      imageSize: DEFAULT_IMAGE_SIZE,
      style,
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
