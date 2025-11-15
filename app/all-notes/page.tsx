'use client';

import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { NoteWithVideo, NoteSource } from '@/lib/types';
import { fetchAllNotes, deleteNote } from '@/lib/notes-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Search, Trash2, Video, NotebookPen, Loader2, ArrowUpDown } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function getSourceLabel(source: NoteSource) {
  switch (source) {
    case 'chat':
      return 'AI Message';
    case 'takeaways':
      return 'Takeaways';
    case 'transcript':
      return 'Transcript';
    default:
      return 'Custom';
  }
}

function getSourceColor(source: NoteSource) {
  switch (source) {
    case 'chat':
      return 'bg-blue-100 text-blue-700';
    case 'takeaways':
      return 'bg-green-100 text-green-700';
    case 'transcript':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

const markdownComponents = {
  p: ({ children }: any) => (
    <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
  ),
  ul: ({ children }: any) => (
    <ul className="list-disc list-inside space-y-1 mb-2 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal list-inside space-y-1 mb-2 last:mb-0">{children}</ol>
  ),
  li: ({ children }: any) => (
    <li className="whitespace-pre-wrap">{children}</li>
  ),
  a: ({ children, href, ...props }: any) => (
    <a
      href={href}
      className="text-primary hover:text-primary/80 underline decoration-1 underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ inline, className, children, ...props }: any) => (
    inline ? (
      <code className="bg-background/80 px-1 py-0.5 rounded text-xs" {...props}>
        {children}
      </code>
    ) : (
      <pre className="bg-background/70 p-3 rounded-lg overflow-x-auto text-xs space-y-2">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    )
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic">{children}</blockquote>
  ),
  strong: ({ children }: any) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: any) => (
    <em className="italic">{children}</em>
  ),
  h1: ({ children }: any) => (
    <h1 className="text-base font-semibold mb-2">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-sm font-semibold mb-1">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-sm font-medium mb-1">{children}</h3>
  ),
};

type SortOption = 'recent' | 'oldest' | 'video';

export default function AllNotesPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteWithVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<NoteSource | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    try {
      setLoading(true);
      setError(null);
      const fetchedNotes = await fetchAllNotes();
      setNotes(fetchedNotes);
    } catch (err) {
      console.error('Error loading notes:', err);
      if (err instanceof Error && err.message.includes('401')) {
        // Redirect to home if not authenticated
        router.push('/');
      } else {
        setError('Failed to load notes. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await deleteNote(noteId);
      setNotes(prev => prev.filter(note => note.id !== noteId));
    } catch (err) {
      console.error('Error deleting note:', err);
      alert('Failed to delete note. Please try again.');
    }
  }

  // Group notes by video with sorting
  const groupedNotes = useMemo(() => {
    const filtered = notes.filter(note => {
      const matchesSearch = searchQuery.trim() === '' ||
        note.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.video?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.video?.author.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSource = filterSource === 'all' || note.source === filterSource;

      return matchesSearch && matchesSource;
    });

    // Sort notes first
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'recent') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      } else if (sortBy === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        // Sort by video title
        const titleA = a.video?.title || '';
        const titleB = b.video?.title || '';
        return titleA.localeCompare(titleB);
      }
    });

    const grouped = sorted.reduce<Record<string, { video: NoteWithVideo['video'], notes: NoteWithVideo[] }>>((acc, note) => {
      const videoId = note.video?.youtubeId || 'unknown';
      if (!acc[videoId]) {
        acc[videoId] = {
          video: note.video,
          notes: []
        };
      }
      acc[videoId].notes.push(note);
      return acc;
    }, {});

    return grouped;
  }, [notes, searchQuery, filterSource, sortBy]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="text-center py-12">
          <p className="text-lg text-destructive mb-4">{error}</p>
          <Button onClick={loadNotes}>Try Again</Button>
        </div>
      </div>
    );
  }

  const totalNotes = notes.length;
  const filteredCount = Object.values(groupedNotes).reduce((sum, group) => sum + group.notes.length, 0);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">My Notes</h1>
          <p className="text-muted-foreground">
            {totalNotes === 0 ? 'No notes yet' : `${totalNotes} ${totalNotes === 1 ? 'note' : 'notes'} saved from your videos`}
          </p>
        </div>

        {/* Search and Filter */}
        {totalNotes > 0 && (
          <div className="mb-6 space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search notes or videos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11 bg-background border-border/60 focus-visible:border-primary/50"
              />
            </div>

            {/* Filters and Sort */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Source Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground font-medium mr-1">Filter:</span>
                <button
                  onClick={() => setFilterSource('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filterSource === 'all'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilterSource('chat')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filterSource === 'chat'
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900'
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setFilterSource('transcript')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filterSource === 'transcript'
                      ? 'bg-purple-500 text-white shadow-sm'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900'
                  }`}
                >
                  Transcript
                </button>
                <button
                  onClick={() => setFilterSource('takeaways')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    filterSource === 'takeaways'
                      ? 'bg-green-500 text-white shadow-sm'
                      : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900'
                  }`}
                >
                  Takeaways
                </button>
              </div>

              {/* Sort Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-9">
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span className="text-xs">
                      {sortBy === 'recent' ? 'Most Recent' : sortBy === 'oldest' ? 'Oldest First' : 'By Video'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => setSortBy('recent')}>
                    Most Recent
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('oldest')}>
                    Oldest First
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('video')}>
                    By Video
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}

      {/* Notes Content */}
      {totalNotes === 0 ? (
        <div className="text-center py-16">
          <div className="inline-flex p-4 rounded-full bg-muted/50 mb-4">
            <NotebookPen className="w-12 h-12 text-muted-foreground/50" />
          </div>
          <p className="text-lg font-medium text-foreground mb-2">
            No notes yet
          </p>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Highlight text from transcripts or chat messages to create notes while analyzing videos.
          </p>
          <Link href="/">
            <Button className="gap-2">
              <Video className="w-4 h-4" />
              Analyze a Video
            </Button>
          </Link>
        </div>
      ) : filteredCount === 0 ? (
        <div className="text-center py-16">
          <div className="inline-flex p-4 rounded-full bg-muted/50 mb-4">
            <Search className="w-12 h-12 text-muted-foreground/50" />
          </div>
          <p className="text-lg font-medium text-foreground mb-2">
            No results found
          </p>
          <p className="text-sm text-muted-foreground">
            Try adjusting your search or filters
          </p>
        </div>
      ) : (
        /* Padding wrapper to prevent shadow cutoff */
        <div className="px-1 pb-4">
          <div className="space-y-6">
              {Object.entries(groupedNotes).map(([videoId, { video, notes: videoNotes }]) => (
                <Card
                  key={videoId}
                  className="overflow-hidden border-border/60 shadow-none hover:shadow-lg transition-shadow duration-200"
                >
                  {/* Video Header Section */}
                  <Link href={`/analyze/${videoId}`} className="block group">
                    <div className="flex gap-4 p-4 hover:bg-muted/10 transition-colors">
                      {video?.thumbnailUrl && (
                        <div className="relative w-28 h-[70px] flex-shrink-0 rounded-md overflow-hidden bg-muted shadow-sm">
                          <Image
                            src={video.thumbnailUrl}
                            alt={video.title}
                            fill
                            className="object-cover"
                            sizes="112px"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-base line-clamp-1 mb-1 group-hover:text-primary transition-colors">
                          {video?.title || 'Unknown Video'}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                          {video?.author || 'Unknown Author'}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {video?.duration && (
                            <span className="flex items-center gap-1">
                              <Video className="w-3 h-3" />
                              {formatDuration(video.duration)}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <NotebookPen className="w-3 h-3" />
                            {videoNotes.length} {videoNotes.length === 1 ? 'note' : 'notes'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>

                  {/* Divider */}
                  <div className="border-t border-border/50" />

                  {/* Notes List */}
                  <div className="divide-y divide-border/40">
                    {videoNotes.map((note, index) => {
                      const selectedText = note.metadata?.selectedText?.trim();
                      const text = note.text ?? '';

                      let quoteText = '';
                      let additionalText = '';

                      if (selectedText) {
                        quoteText = selectedText;
                        if (text.startsWith(selectedText)) {
                          additionalText = text.slice(selectedText.length).trimStart();
                        } else if (text !== selectedText) {
                          additionalText = text;
                        }
                      } else {
                        const parts = text.split(/\n{2,}/);
                        quoteText = parts[0] ?? '';
                        additionalText = parts.slice(1).join('\n\n');
                      }

                      return (
                        <div
                          key={note.id}
                          className="group p-4 first:pt-0 last:pb-0 hover:bg-accent/20 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 space-y-2.5">
                              {/* Source Badge and Timestamp */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider ${getSourceColor(note.source)}`}>
                                  {getSourceLabel(note.source)}
                                </span>
                                {note.metadata?.timestampLabel && (
                                  <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                                    {note.metadata.timestampLabel}
                                  </span>
                                )}
                              </div>

                              {/* Note Content */}
                              {quoteText && (
                                <div className="border-l-2 border-primary/40 pl-3 py-1 rounded-r text-sm text-foreground/90 leading-relaxed">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={markdownComponents}
                                  >
                                    {quoteText}
                                  </ReactMarkdown>
                                </div>
                              )}
                              {additionalText && (
                                <div className="text-sm leading-relaxed text-foreground/95 pt-1">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={markdownComponents}
                                  >
                                    {additionalText}
                                  </ReactMarkdown>
                                </div>
                              )}

                              {/* Created Date */}
                              <div className="text-[11px] text-muted-foreground/80 font-medium pt-1">
                                {new Date(note.createdAt).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </div>
                            </div>

                            {/* Delete Button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleDeleteNote(note.id);
                                  }}
                                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                                  aria-label="Delete note"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                <span className="text-xs">Delete note</span>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
          </div>
        </div>
      )}
      </div>
    </TooltipProvider>
  );
}
