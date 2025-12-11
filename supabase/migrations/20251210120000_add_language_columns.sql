-- Migration: Add language columns to video_analyses table
-- Purpose: Store transcript language and available languages for proper language selector state

-- Add language column to store the current transcript's language
ALTER TABLE public.video_analyses
ADD COLUMN IF NOT EXISTS language text;

-- Add available_languages column to store list of available native transcript languages
ALTER TABLE public.video_analyses
ADD COLUMN IF NOT EXISTS available_languages jsonb;

-- Add comments for documentation
COMMENT ON COLUMN public.video_analyses.language IS 'ISO language code of the cached transcript (e.g., en, es, ja)';
COMMENT ON COLUMN public.video_analyses.available_languages IS 'JSON array of available native transcript language codes';

-- Create index for potential language-based queries
CREATE INDEX IF NOT EXISTS idx_video_analyses_language ON public.video_analyses(language);

-- ----------------------------------------------------------------------------
-- Update Function: upsert_video_analysis_with_user_link
-- Purpose: Add support for language and available_languages parameters
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_video_analysis_with_user_link(
    p_youtube_id text,
    p_title text,
    p_author text,
    p_duration integer,
    p_thumbnail_url text,
    p_transcript jsonb,
    p_topics jsonb,
    p_summary jsonb,
    p_suggested_questions jsonb,
    p_model_used text,
    p_user_id uuid DEFAULT NULL,
    p_language text DEFAULT NULL,
    p_available_languages jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_video_id uuid;
BEGIN
    -- Insert or update video analysis
    INSERT INTO public.video_analyses (
        youtube_id,
        title,
        author,
        duration,
        thumbnail_url,
        transcript,
        topics,
        summary,
        suggested_questions,
        model_used,
        language,
        available_languages
    ) VALUES (
        p_youtube_id,
        p_title,
        p_author,
        p_duration,
        p_thumbnail_url,
        p_transcript,
        p_topics,
        p_summary,
        p_suggested_questions,
        p_model_used,
        p_language,
        p_available_languages
    )
    ON CONFLICT (youtube_id) DO UPDATE SET
        transcript = COALESCE(EXCLUDED.transcript, video_analyses.transcript),
        topics = COALESCE(EXCLUDED.topics, video_analyses.topics),
        summary = COALESCE(EXCLUDED.summary, video_analyses.summary),
        suggested_questions = COALESCE(EXCLUDED.suggested_questions, video_analyses.suggested_questions),
        language = COALESCE(EXCLUDED.language, video_analyses.language),
        available_languages = COALESCE(EXCLUDED.available_languages, video_analyses.available_languages),
        updated_at = timezone('utc'::text, now())
    RETURNING id INTO v_video_id;

    -- Link to user if user_id provided
    IF p_user_id IS NOT NULL THEN
        INSERT INTO public.user_videos (user_id, video_id, accessed_at)
        VALUES (p_user_id, v_video_id, timezone('utc'::text, now()))
        ON CONFLICT (user_id, video_id) DO UPDATE SET
            accessed_at = timezone('utc'::text, now());
    END IF;

    RETURN v_video_id;
END;
$$;

