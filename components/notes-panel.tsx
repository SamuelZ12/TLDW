import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Note, NoteSource, NoteMetadata } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trash2, Clock } from "lucide-react";
import { NoteEditor } from "@/components/note-editor";

function formatDateOnly(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
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

export interface EditingNote {
  text: string;
  metadata?: NoteMetadata | null;
  source?: string;
}

interface NotesPanelProps {
  notes?: Note[];
  onDeleteNote?: (noteId: string) => Promise<void>;
  editingNote?: EditingNote | null;
  onSaveEditingNote?: (noteText: string) => void;
  onCancelEditing?: () => void;
  isAuthenticated?: boolean;
  onSignInClick?: () => void;
}

function getSourceLabel(source: NoteSource) {
  switch (source) {
    case "chat":
      return "AI Message";
    case "takeaways":
      return "Takeaways";
    case "transcript":
      return "Transcript";
    default:
      return "Custom";
  }
}

export function NotesPanel({ notes = [], onDeleteNote, editingNote, onSaveEditingNote, onCancelEditing, isAuthenticated = true, onSignInClick }: NotesPanelProps) {
  const groupedNotes = useMemo(() => {
    return notes.reduce<Record<NoteSource, Note[]>>((acc, note) => {
      const list = acc[note.source] || [];
      list.push(note);
      acc[note.source] = list;
      return acc;
    }, {} as Record<NoteSource, Note[]>);
  }, [notes]);

  if (!isAuthenticated) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">Sign in to save notes</h3>
          <p className="text-xs text-muted-foreground">
            Highlight transcript moments and keep your takeaways in one place.
          </p>
        </div>
        <Button
          size="sm"
          className="rounded-full px-4"
          onClick={() => onSignInClick?.()}
        >
          Sign in to save notes
        </Button>
      </div>
    );
  }

  if (!notes.length && !editingNote) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        Your saved notes will appear here. Highlight transcript or chat text to take a note.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5 w-full max-w-full overflow-hidden">
        {/* Note Editor - shown when editing */}
        {editingNote && onSaveEditingNote && onCancelEditing && (
          <NoteEditor
            selectedText={editingNote.text}
            metadata={editingNote.metadata}
            onSave={onSaveEditingNote}
            onCancel={onCancelEditing}
          />
        )}

        {/* Saved Notes - grouped by source */}
        {Object.entries(groupedNotes).map(([source, sourceNotes]) => (
          <div key={source} className="space-y-3">
            <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {getSourceLabel(source as NoteSource)}
            </div>
            <div className="space-y-2.5">
              {sourceNotes.map((note) => {
                const selectedText = note.metadata?.selectedText?.trim();
                const text = note.text ?? "";

                let quoteText = "";
                    let additionalText = "";

                if (selectedText) {
                  quoteText = selectedText;
                  if (text.startsWith(selectedText)) {
                    additionalText = text.slice(selectedText.length).trimStart();
                  } else if (text !== selectedText) {
                    additionalText = text;
                  }
                } else {
                  const parts = text.split(/\n{2,}/);
                  quoteText = parts[0] ?? "";
                  additionalText = parts.slice(1).join("\n\n");
                }

                const isTranscriptNote = note.source === "transcript";

                const inlineMetadata: ReactNode[] = [];

                if (!isTranscriptNote && note.metadata?.selectionContext) {
                  inlineMetadata.push(
                    <span key="context" className="truncate" title={note.metadata.selectionContext}>
                      {note.metadata.selectionContext}
                    </span>
                  );
                }

                if (!isTranscriptNote && note.metadata?.timestampLabel) {
                  inlineMetadata.push(
                    <span key="timestamp" className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {note.metadata.timestampLabel}
                    </span>
                  );
                }

                inlineMetadata.push(
                  <span key="date">
                    {formatDateOnly(note.createdAt)}
                  </span>
                );

                const shouldShowSegmentInfo =
                  !isTranscriptNote && note.metadata?.transcript?.segmentIndex !== undefined;

                return (
                  <Card key={note.id} className="group p-3.5 bg-white hover:bg-neutral-50/60 border-none shadow-none transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-2">
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
                          <div className="text-sm leading-relaxed text-foreground">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {additionalText}
                            </ReactMarkdown>
                          </div>
                        )}
                        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-3">
                            {inlineMetadata}
                          </div>
                          {shouldShowSegmentInfo && note.metadata?.transcript && note.metadata.transcript.segmentIndex !== undefined && (
                            <span className="text-muted-foreground/80">
                              Segment #{note.metadata.transcript.segmentIndex + 1}
                            </span>
                          )}
                        </div>
                      </div>
                      {onDeleteNote && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onDeleteNote(note.id)}
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <span className="text-xs">Delete note</span>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
