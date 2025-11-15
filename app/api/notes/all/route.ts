import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';

interface NoteWithVideoRow {
  id: string;
  user_id: string;
  video_id: string;
  source: string;
  source_id: string | null;
  note_text: string;
  metadata: any;
  created_at: string;
  updated_at: string;
  video_analyses: {
    youtube_id: string;
    title: string;
    author: string;
    thumbnail_url: string;
    duration: number;
  } | null;
}

function mapNoteWithVideo(row: NoteWithVideoRow) {
  return {
    id: row.id,
    userId: row.user_id,
    videoId: row.video_id,
    source: row.source,
    sourceId: row.source_id,
    text: row.note_text,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    video: row.video_analyses ? {
      youtubeId: row.video_analyses.youtube_id,
      title: row.video_analyses.title,
      author: row.video_analyses.author,
      thumbnailUrl: row.video_analyses.thumbnail_url,
      duration: row.video_analyses.duration,
    } : null,
  };
}

async function handler(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (req.method === 'GET') {
    try {
      // Fetch all notes for the user with video metadata
      const { data, error } = await supabase
        .from('user_notes')
        .select(`
          *,
          video_analyses!inner(
            youtube_id,
            title,
            author,
            thumbnail_url,
            duration
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      const notes = (data || []).map(mapNoteWithVideo);

      return NextResponse.json({ notes });
    } catch (error) {
      console.error('Error fetching all notes:', error);
      return NextResponse.json(
        { error: 'Failed to fetch notes' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export const GET = withSecurity(handler, SECURITY_PRESETS.AUTHENTICATED);
