import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withSecurity, SECURITY_PRESETS } from "@/lib/security-middleware";

interface RandomVideoRow {
  youtube_id: string;
  title: string | null;
  author: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  slug: string | null;
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

    const randomIndex = Math.floor(Math.random() * count);

    const { data, error: fetchError } = await supabase
      .from("video_analyses")
      .select("youtube_id,title,author,duration,thumbnail_url,slug")
      .not("topics", "is", null)
      .order("created_at", { ascending: false })
      .range(randomIndex, randomIndex);

    if (fetchError) {
      console.error("Failed to fetch random analyzed video:", fetchError);
      return NextResponse.json(
        { error: "Unable to load a sample video right now." },
        { status: 500 }
      );
    }

    const randomVideo = Array.isArray(data) ? (data[0] as RandomVideoRow | undefined) : undefined;

    if (!randomVideo || !randomVideo.youtube_id) {
      return NextResponse.json(
        { error: "Unable to load a sample video right now." },
        { status: 500 }
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
