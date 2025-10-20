import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateWithGrounding } from '@/lib/gemini-client-v2';
import { explainResponseSchema } from '@/lib/schemas';
import { withSecurity } from '@/lib/security-middleware';
import { RateLimiter, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limiter';
import { createClient } from '@/lib/supabase/server';
import { formatValidationError } from '@/lib/validation';

// Request validation schema
const explainRequestSchema = z.object({
  currentSentence: z.string().min(1),
  videoTitle: z.string().optional(),
  videoDescription: z.string().optional(),
  linesBefore: z.array(z.string()).max(2).optional(),
  linesAfter: z.array(z.string()).max(2).optional(),
});

async function handler(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();

    let validatedData;
    try {
      validatedData = explainRequestSchema.parse(body);
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
      currentSentence,
      videoTitle,
      videoDescription,
      linesBefore = [],
      linesAfter = []
    } = validatedData;

    // Check rate limiting - stricter for explanations due to Google Search cost
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const rateLimitConfig = user ? RATE_LIMITS.AUTH_EXPLAIN : RATE_LIMITS.ANON_EXPLAIN;
    const rateLimitResult = await RateLimiter.check('explain', rateLimitConfig);

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult) || NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before requesting more explanations.' },
        { status: 429 }
      );
    }

    // Build the specialized prompt with context
    const contextBeforeText = linesBefore.length > 0
      ? linesBefore.join('\n')
      : 'Not available';

    const contextAfterText = linesAfter.length > 0
      ? linesAfter.join('\n')
      : 'Not available';

    const prompt = `Persona

You are an expert explainer. Your goal is to help a non-expert YouTube viewer understand potentially confusing words, expressions, or concepts from a video transcript. You must be concise, clear, and always tailor your explanations to the specific context of the video.

Primary Directive

Analyze the Current sentence from the video transcript using the provided Context. Identify any jargon, terminology, abbreviations, proper nouns (people, places, companies, etc), or complex concepts that a beginner would likely not understand. Provide a simple, context-specific explanation for each.

---

**Inputs:**

* **Current sentence**: ${currentSentence}
* **Context**:
  * **Video title**: ${videoTitle || 'Not available'}
  * **Video description**: ${videoDescription || 'Not available'}
  * **The 2 lines before current sentence**: ${contextBeforeText}
  * **The 2 lines following current sentence**: ${contextAfterText}

---

**Task & Rules:**

1. **Identify**: Pinpoint the most difficult term(s) in the Current sentence. There may be more than one. If you suspect a transcription error, deduce the correct term from the context and explain that.
2. **Explain with Context**: Your explanation MUST be relevant to how the term is used in the video. Do not give a generic dictionary definition. Use the provided context to infer the precise meaning.
3. **Simplicity is Key**: Explain things in simple, layman's terms. Assume the user has no prior knowledge of the subject. Do not introduce new, complex jargon in your explanation.
4. **Be Concise**: Each explanation should be three sentences or less.
5. **Handle Multiple Terms**: If there are multiple terms to explain, create an array of explanations.
6. **Handle Simple Sentences**: If the sentence contains no difficult concepts and is self-explanatory (e.g., "Thank you for watching"), set isSelfExplanatory to true and return an empty explanations array. If the sentence is simple but its relevance might be unclear, set isSelfExplanatory to false and briefly explain its main point in the context of the video.
7. **Use Web Search**: You have access to Google Search to ensure accuracy, especially for proper nouns and specialized terminology. Use it when needed.

**Output Format:**

Return a JSON object with the following structure:
{
  "isSelfExplanatory": boolean,
  "explanations": [
    {
      "term": "string (the term being explained)",
      "explanation": "string (the explanation)"
    }
  ]
}

If isSelfExplanatory is true, the explanations array should be empty.

**Example:**

**Inputs:**

* **Current sentence**: "So, the key here is to short the VIX, and we're going to do that through a classic contango play."
* **Context**:
  * **Video title**: Advanced Options Trading Strategies
  * **Video description**: A deep dive into VIX futures and profiting from market volatility.
  * **The 2 lines before current sentence**: "The market has been panicking, so volatility is incredibly high right now. But we don't think that's going to last."
  * **The 2 lines following current sentence**: "This allows us to profit as the term structure normalizes. Of course, this comes with significant risk if volatility continues to rise."

**Correct Output:**

{
  "isSelfExplanatory": false,
  "explanations": [
    {
      "term": "Short the VIX",
      "explanation": "A trading strategy that is a bet on the VIX (an index measuring expected stock market volatility) going down. In this video, it means the speaker expects the market to become calmer."
    },
    {
      "term": "Contango play",
      "explanation": "A strategy to profit from a specific situation in the futures market where contracts for a later delivery date are more expensive than contracts for an earlier date. The trader expects this price gap to shrink over time."
    }
  ]
}`;

    console.log('=== EXPLAIN API REQUEST ===');
    console.log('Current sentence:', currentSentence);
    console.log('Video title:', videoTitle);
    console.log('Context lines before:', linesBefore.length);
    console.log('Context lines after:', linesAfter.length);
    console.log('=== END REQUEST ===');

    // Generate explanation with Google Search grounding
    let response: string;
    try {
      response = await generateWithGrounding(prompt, {
        temperature: 0.5,
        maxOutputTokens: 2048,
        zodSchema: explainResponseSchema,
        timeoutMs: 30000, // 30 second timeout
      });

      console.log('=== GEMINI RAW RESPONSE ===');
      console.log('Response:', response);
      console.log('=== END RAW RESPONSE ===');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Gemini API error:', errorMessage);

      if (errorMessage.includes('429') || errorMessage.includes('quota')) {
        return NextResponse.json({
          error: "The AI service is currently at capacity. Please wait a moment and try again."
        }, { status: 503 });
      }

      return NextResponse.json({
        error: "Failed to generate explanation. Please try again."
      }, { status: 500 });
    }

    // Parse and validate response
    let parsedResponse;
    try {
      const parsedJson = JSON.parse(response);
      parsedResponse = explainResponseSchema.parse(parsedJson);
    } catch (error) {
      console.error('Failed to parse response:', error);
      return NextResponse.json({
        error: "Received invalid response from AI. Please try again."
      }, { status: 500 });
    }

    console.log('=== PARSED EXPLANATION ===');
    console.log('Is self-explanatory:', parsedResponse.isSelfExplanatory);
    console.log('Explanations count:', parsedResponse.explanations?.length ?? 0);
    console.log('=== END PARSED EXPLANATION ===');

    return NextResponse.json(parsedResponse);
  } catch (error) {
    console.error('Explain API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate explanation' },
      { status: 500 }
    );
  }
}

// Apply security middleware with stricter body size limit
export const POST = withSecurity(handler, {
  maxBodySize: 50 * 1024, // 50KB - explanations have smaller context than full chat
  allowedMethods: ['POST']
});
