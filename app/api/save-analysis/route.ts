import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { z } from 'zod';
import { formatValidationError } from '@/lib/validation';

const saveAnalysisSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
  videoInfo: z.object({
    title: z.string(),
    author: z.string().optional(),
    duration: z.number().optional(),
    thumbnail: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional()
  }),
  transcript: z.array(z.object({
    text: z.string(),
    start: z.number(),
    duration: z.number()
  })),
  topics: z.array(z.any()),
  summary: z.string().nullable().optional(),
  suggestedQuestions: z.array(z.string()).nullable().optional(),
  model: z.string().default('gemini-2.5-flash')
});

async function handler(req: NextRequest) {
  try {
    const body = await req.json();

    let validatedData;
    try {
      validatedData = saveAnalysisSchema.parse(body);
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
      videoId,
      videoInfo,
      transcript,
      topics,
      summary,
      suggestedQuestions,
      model
    } = validatedData;

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();

    const { data: result, error: saveError } = await supabase
      .rpc('upsert_video_analysis_with_user_link', {
        p_youtube_id: videoId,
        p_title: videoInfo.title,
        p_author: videoInfo.author || null,
        p_duration: videoInfo.duration || null,
        p_thumbnail_url: videoInfo.thumbnail || null,
        p_transcript: transcript,
        p_topics: topics,
        p_summary: summary || null,
        p_suggested_questions: suggestedQuestions || null,
        p_model_used: model,
        p_user_id: user?.id || null
      })
      .single();

    if (saveError) {
      console.error('Error saving video analysis:', saveError);
      return NextResponse.json(
        {
          error: 'Failed to save video analysis',
          details: saveError.message
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      saved: true,
      data: result
    });

  } catch (error) {
    console.error('Error in save analysis:', error);
    return NextResponse.json(
      { error: 'An error occurred while saving your analysis' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.PUBLIC);