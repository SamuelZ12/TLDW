import { csrfFetch } from '@/lib/csrf-client';
import { Note, NoteMetadata, NoteSource, NoteWithVideo } from '@/lib/types';

interface SaveNotePayload {
  youtubeId: string;
  videoId?: string;
  source: NoteSource;
  sourceId?: string;
  text: string;
  metadata?: NoteMetadata;
}

export async function fetchNotes(params: { youtubeId: string }): Promise<Note[]> {
  const query = new URLSearchParams();
  query.set('youtubeId', params.youtubeId);

  const response = await csrfFetch.get(`/api/notes?${query.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch notes');
  }

  const data = await response.json();
  return (data.notes || []) as Note[];
}

export async function saveNote(payload: SaveNotePayload): Promise<Note> {
  const response = await csrfFetch.post('/api/notes', payload);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to save note');
  }

  const data = await response.json();
  return data.note as Note;
}

export async function deleteNote(noteId: string): Promise<void> {
  const response = await csrfFetch.delete('/api/notes', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteId })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || 'Failed to delete note');
  }
}

export async function fetchAllNotes(): Promise<NoteWithVideo[]> {
  const response = await csrfFetch.get('/api/notes/all');

  if (!response.ok) {
    throw new Error('Failed to fetch all notes');
  }

  const data = await response.json();
  return (data.notes || []) as NoteWithVideo[];
}
