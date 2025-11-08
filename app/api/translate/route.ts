import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';
import { getTranslationClient } from '@/lib/translation';
import { z } from 'zod';

const translateRequestSchema = z.object({
  text: z.string().min(1),
  targetLanguage: z.string().default('zh-CN'),
});

const translateBatchRequestSchema = z.object({
  texts: z.array(z.string()),
  targetLanguage: z.string().default('zh-CN'),
});

async function handler(request: NextRequest) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
    const body = requestBody;

    console.log('[TRANSLATE] Translation request:', {
      isBatch: Array.isArray(body.texts),
      textCount: Array.isArray(body.texts) ? body.texts.length : 1,
      targetLanguage: body.targetLanguage
    });

    // Determine if this is a batch or single translation request
    const isBatch = Array.isArray(body.texts);

    if (isBatch) {
      // Handle batch translation
      const validation = translateBatchRequestSchema.safeParse(body);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Invalid request format', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const { texts, targetLanguage } = validation.data;

      if (texts.length === 0) {
        return NextResponse.json({ translations: [] });
      }

      if (texts.length > 100) {
        return NextResponse.json(
          { error: 'Batch size too large. Maximum 100 texts allowed.' },
          { status: 400 }
        );
      }

      const translationClient = getTranslationClient();
      const translations = await translationClient.translateBatch(texts, targetLanguage);

      return NextResponse.json({ translations });
    } else {
      // Handle single translation
      const validation = translateRequestSchema.safeParse(body);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Invalid request format', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const { text, targetLanguage } = validation.data;

      const translationClient = getTranslationClient();
      const translation = await translationClient.translate(text, targetLanguage);

      return NextResponse.json({ translation });
    }
  } catch (error) {
    // Log full error details server-side for debugging
    console.error('[TRANSLATE] Translation error:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: requestBody || 'Unable to parse request body',
      timestamp: new Date().toISOString(),
    });

    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        return NextResponse.json(
          { error: 'Translation service configuration error' },
          { status: 500 }
        );
      }
      if (error.message.includes('quota') || error.message.includes('limit')) {
        return NextResponse.json(
          { error: 'Translation service quota exceeded' },
          { status: 429 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Translation failed' },
      { status: 500 }
    );
  }
}

// Apply security with translation-specific rate limits
export const POST = withSecurity(handler, {
  rateLimit: RATE_LIMITS.TRANSLATION, // Higher limit since client caches translations
  maxBodySize: 1024 * 1024, // 1MB should be sufficient for text translation
  allowedMethods: ['POST']
});