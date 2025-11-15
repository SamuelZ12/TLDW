import { NextRequest, NextResponse } from 'next/server';
import { generateTopicsRequestSchema, formatValidationError } from '@/lib/validation';
import { z } from 'zod';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';
import { generateTopicsFromTranscript } from '@/lib/ai-processing';
import { GeminiGenerationError, GeminiErrorType } from '@/lib/gemini-client';

function respondWithGeminiError(error: GeminiGenerationError) {
  const statusMap: Record<GeminiErrorType, number> = {
    overloaded: 503,
    'rate limited': 503,
    'authentication failed': 500,
    'invalid request': 500,
    'unknown error': 500
  };

  const messageMap: Record<GeminiErrorType, string> = {
    overloaded: 'Gemini is overloaded right now. Please try again in a few minutes.',
    'rate limited': 'Gemini is temporarily rate-limited. Please wait a moment and try again.',
    'authentication failed': 'We could not authenticate with Gemini. Please try again later.',
    'invalid request': 'The AI service could not process the request. Please try again later.',
    'unknown error': 'Gemini is unavailable right now. Please try again later.'
  };

  const codeMap: Record<GeminiErrorType, string> = {
    overloaded: 'GEMINI_OVERLOADED',
    'rate limited': 'GEMINI_RATE_LIMITED',
    'authentication failed': 'GEMINI_AUTH_ERROR',
    'invalid request': 'GEMINI_INVALID_REQUEST',
    'unknown error': 'GEMINI_UNAVAILABLE'
  };

  const type = error.type ?? 'unknown error';
  const status = statusMap[type] ?? 500;

  return NextResponse.json(
    {
      error: messageMap[type] ?? messageMap['unknown error'],
      code: codeMap[type],
      details: error.message,
      attemptedModels: error.attemptedModels,
      retryable: type === 'overloaded' || type === 'rate limited'
    },
    { status }
  );
}

async function handler(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();

    let validatedData;
    try {
      validatedData = generateTopicsRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: formatValidationError(error)
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const { transcript, model, includeCandidatePool, excludeTopicKeys, videoInfo, mode } = validatedData;

    // Use the shared function to generate topics
    const { topics, candidates } = await generateTopicsFromTranscript(transcript, model, {
      videoInfo,
      includeCandidatePool,
      excludeTopicKeys: new Set(excludeTopicKeys ?? []),
      mode
    });

    return NextResponse.json({
      topics,
      topicCandidates: includeCandidatePool ? candidates ?? [] : undefined
    });
  } catch (error) {
    // Log error details server-side only
    console.error('Error generating topics:', error);

    if (error instanceof GeminiGenerationError) {
      return respondWithGeminiError(error);
    }

    // Return generic error message to client
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

// Apply security with generation rate limits (dynamic based on auth)
export const POST = withSecurity(handler, {
  maxBodySize: 10 * 1024 * 1024, // 10MB for large transcripts
  allowedMethods: ['POST']
  // Note: Rate limiting is handled internally by the route for dynamic limits based on auth
});
