import { NextRequest, NextResponse } from 'next/server';
import {
  generateTopicsRequestSchema,
  formatValidationError
} from '@/lib/validation';
import { z } from 'zod';
import { withSecurity } from '@/lib/security-middleware';
import { generateTopicsFromTranscript } from '@/lib/ai-processing';

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

    const {
      transcript,
      model,
      includeCandidatePool,
      excludeTopicKeys,
      videoInfo,
      mode,
      language
    } = validatedData;

    // Use the shared function to generate topics
    const { topics, candidates } = await generateTopicsFromTranscript(
      transcript,
      model,
      {
        videoInfo,
        includeCandidatePool,
        excludeTopicKeys: new Set(excludeTopicKeys ?? []),
        mode,
        language
      }
    );

    return NextResponse.json({
      topics,
      topicCandidates: includeCandidatePool ? candidates ?? [] : undefined
    });
  } catch (error) {
    // Log error details server-side only
    console.error('Error generating topics:', error);

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
