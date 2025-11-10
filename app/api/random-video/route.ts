import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isTranscriptEnglish } from "@/lib/transcript-language";
import { withSecurity, SECURITY_PRESETS } from "@/lib/security-middleware";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface RandomVideoRow {
  youtube_id: string;
  title: string | null;
  author: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  slug: string | null;
  transcript: unknown;
}

const RANDOM_BATCH_SIZE = 5;
const MAX_RANDOM_ATTEMPTS = 6;
const FALLBACK_BATCH_SIZE = 40;

async function fetchVideoBatch(
  supabase: SupabaseServerClient,
  start: number,
  end: number
): Promise<RandomVideoRow[]> {
  const { data, error } = await supabase
    .from("video_analyses")
    .select("youtube_id,title,author,duration,thumbnail_url,slug,transcript")
    .not("topics", "is", null)
    .order("created_at", { ascending: false })
    .range(start, end);

  if (error) {
    console.error("Failed to fetch video batch for feeling lucky:", error);
    throw error;
  }

  return Array.isArray(data) ? (data as RandomVideoRow[]) : [];
}

function selectEnglishVideo(batch: RandomVideoRow[]): RandomVideoRow | null {
  return batch.find((row) => isTranscriptEnglish(row.transcript)) ?? null;
}

async function getRandomEnglishVideo(
  supabase: SupabaseServerClient,
  totalCount: number
): Promise<RandomVideoRow | null> {
  if (totalCount <= 0) {
    return null;
  }

  const lastIndex = totalCount - 1;

  for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt += 1) {
    const randomIndex = Math.floor(Math.random() * totalCount);
    const startIndex = randomIndex;
    const endIndex = Math.min(lastIndex, randomIndex + RANDOM_BATCH_SIZE - 1);

    const batch = await fetchVideoBatch(supabase, startIndex, endIndex);
    const englishCandidate = selectEnglishVideo(batch);

    if (englishCandidate) {
      return englishCandidate;
    }
  }

  const fallbackEnd = Math.min(lastIndex, FALLBACK_BATCH_SIZE - 1);
  const fallbackBatch = await fetchVideoBatch(supabase, 0, fallbackEnd);
  return selectEnglishVideo(fallbackBatch);
}

async function handler() {
  try {
    const supabase = await createClient();

    const { count, error: countError } = await supabase
      .from("video_analyses")
      .select("id", { count: "exact", head: true })
      .not("topics", "is", null);

    if (countError) {
      console.error("Failed to count video analyses for feeling lucky:", countError);
      return NextResponse.json(
        { error: "Unable to load a sample video right now." },
        { status: 500 }
      );
    }

    if (!count || count <= 0) {
      return NextResponse.json(
        { error: "No analyzed videos are available yet." },
        { status: 404 }
      );
    }

    const randomVideo = await getRandomEnglishVideo(supabase, count);

    if (!randomVideo) {
      console.warn("No English video found for feeling lucky request.");
      return NextResponse.json(
        { error: "No English analyzed videos are available yet." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      youtubeId: randomVideo.youtube_id,
      title: randomVideo.title,
      author: randomVideo.author,
      duration: randomVideo.duration,
      thumbnail: randomVideo.thumbnail_url,
      slug: randomVideo.slug,
      url: `https://www.youtube.com/watch?v=${randomVideo.youtube_id}`,
    });
  } catch (error) {
    console.error("Unexpected error while resolving feeling lucky request:", error);
    return NextResponse.json(
      { error: "Unable to load a sample video right now." },
      { status: 500 }
    );
  }
}

export const GET = withSecurity(handler, SECURITY_PRESETS.PUBLIC);
