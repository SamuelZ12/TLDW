"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { AIChat } from "@/components/ai-chat";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Languages, MessageSquare, PenLine, ChevronDown, CheckCircle2, Search, Circle } from "lucide-react";
import { TranscriptSegment, Topic, Citation, Note, NoteSource, NoteMetadata, VideoInfo, TranslationRequestHandler } from "@/lib/types";
import { SelectionActionPayload } from "@/components/selection-actions";
import { NotesPanel, EditingNote } from "@/components/notes-panel";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SUPPORTED_LANGUAGES } from "@/lib/language-utils";

const translationSelectorEnabled = (() => {
  const raw = process.env.NEXT_PUBLIC_ENABLE_TRANSLATION_SELECTOR;
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
})();

interface RightColumnTabsProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string, isWithinHighlightReel?: boolean, isWithinCitationHighlight?: boolean) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: Citation | null;
  videoId: string;
  videoTitle?: string;
  videoInfo?: VideoInfo | null;
  onCitationClick: (citation: Citation) => void;
  showChatTab?: boolean;
  cachedSuggestedQuestions?: string[] | null;
  notes?: Note[];
  onSaveNote?: (payload: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => Promise<void>;
  onTakeNoteFromSelection?: (payload: SelectionActionPayload) => void;
  editingNote?: EditingNote | null;
  onSaveEditingNote?: (payload: { noteText: string; selectedText: string }) => void;
  onCancelEditing?: () => void;
  isAuthenticated?: boolean;
  onRequestSignIn?: () => void;
  selectedLanguage?: string | null;
  translationCache?: Map<string, string>;
  onRequestTranslation?: TranslationRequestHandler;
  onLanguageChange?: (languageCode: string | null) => void;
  onRequestExport?: () => void;
  exportButtonState?: {
    tooltip?: string;
    disabled?: boolean;
    badgeLabel?: string;
    isLoading?: boolean;
  };
}

export interface RightColumnTabsHandle {
  switchToTranscript: () => void;
  switchToChat?: () => void;
  switchToNotes: () => void;
}

export const RightColumnTabs = forwardRef<RightColumnTabsHandle, RightColumnTabsProps>(({
  transcript,
  selectedTopic,
  onTimestampClick,
  currentTime,
  topics,
  citationHighlight,
  videoId,
  videoTitle,
  videoInfo,
  onCitationClick,
  showChatTab,
  cachedSuggestedQuestions,
  notes,
  onSaveNote,
  onTakeNoteFromSelection,
  editingNote,
  onSaveEditingNote,
  onCancelEditing,
  isAuthenticated,
  onRequestSignIn,
  selectedLanguage = null,
  translationCache,
  onRequestTranslation,
  onLanguageChange,
  onRequestExport,
  exportButtonState,

}, ref) => {
  const [activeTab, setActiveTab] = useState<"transcript" | "chat" | "notes">("transcript");
  const [languageSearch, setLanguageSearch] = useState("");
  const showTranslationSelector = translationSelectorEnabled;

  // Get current language - null or 'en' means English
  const currentLanguageCode = selectedLanguage || 'en';

  // Filter languages based on search
  const filteredLanguages = SUPPORTED_LANGUAGES.filter(lang =>
    lang.name.toLowerCase().includes(languageSearch.toLowerCase()) ||
    lang.nativeName.toLowerCase().includes(languageSearch.toLowerCase())
  );

  // Expose methods to parent to switch tabs
  useImperativeHandle(ref, () => ({
    switchToTranscript: () => {
      setActiveTab("transcript");
    },
    switchToChat: () => {
      if (showChatTab) {
        setActiveTab("chat");
      }
    },
    switchToNotes: () => {
      setActiveTab("notes");
    }
  }));

  useEffect(() => {
    // If chat tab is removed while active, switch to transcript
    if (!showChatTab && activeTab === "chat") {
      setActiveTab("transcript");
    }
  }, [showChatTab, activeTab]);

  return (
    <Card className="h-full flex flex-col overflow-hidden p-0 gap-0 border-0">
      <div className="flex items-center gap-2 p-2 rounded-t-3xl border-b">
        <div className="flex-1">
          {showTranslationSelector ? (
            <DropdownMenu onOpenChange={(open) => {
              if (open) setActiveTab("transcript");
              if (!open) setLanguageSearch("");
            }}>
              <div className={cn(
                "flex items-center gap-0 rounded-2xl w-full",
                activeTab === "transcript"
                  ? "bg-neutral-100"
                  : "hover:bg-white/50"
              )}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("transcript")}
                  className={cn(
                    "flex-1 justify-center gap-2 rounded-l-2xl rounded-r-none border-0",
                    activeTab === "transcript"
                      ? "text-foreground hover:bg-neutral-100"
                      : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                  )}
                >
                  <Languages className="h-4 w-4" />
                  Transcript
                </Button>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "rounded-r-2xl rounded-l-none border-0 !pl-0",
                      activeTab === "transcript"
                        ? "text-foreground hover:bg-neutral-100"
                        : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                    )}
                  >
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent side="bottom" align="start" sideOffset={4} alignOffset={-200} className="w-[260px]">
                {!isAuthenticated && (
                  <div className="px-3 py-2 border-b">
                    <div className="text-xs font-medium">Sign in to translate</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Translate transcript and topics into 4 languages.
                    </div>
                    <Button
                      size="sm"
                      className="mt-2 h-7 text-xs w-full"
                      onClick={(e) => {
                        e.preventDefault();
                        onRequestSignIn?.();
                      }}
                    >
                      Sign in
                    </Button>
                  </div>
                )}
                <div className="px-2 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search"
                      value={languageSearch}
                      onChange={(e) => setLanguageSearch(e.target.value)}
                      className="h-7 pl-7 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {filteredLanguages.map((lang) => {
                    const isOriginalLanguage = lang.code === 'en';
                    const isTargetLanguage = lang.code === currentLanguageCode && selectedLanguage !== null;

                    return (
                      <DropdownMenuItem
                        key={lang.code}
                        className={cn(
                          "text-xs cursor-pointer",
                          isOriginalLanguage && "cursor-default",
                          !isAuthenticated && !isOriginalLanguage && "opacity-50"
                        )}
                        disabled={isOriginalLanguage || (!isAuthenticated && !isOriginalLanguage)}
                        onClick={(e) => {
                          if (!isAuthenticated && !isOriginalLanguage) {
                            e.preventDefault();
                            onRequestSignIn?.();
                            return;
                          }
                          // Toggle: if clicking the currently selected language, deselect it
                          if (lang.code === currentLanguageCode && selectedLanguage !== null) {
                            onLanguageChange?.(null);
                          } else {
                            onLanguageChange?.(lang.code);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div>
                            <div className="font-medium">{lang.nativeName}</div>
                            <div className="text-[10px] text-muted-foreground">{lang.name}</div>
                          </div>
                          {isOriginalLanguage ? (
                            <CheckCircle2 className="w-4 h-4 text-muted-foreground/50" />
                          ) : isTargetLanguage ? (
                            <CheckCircle2 className="w-4 h-4 text-foreground fill-background" />
                          ) : (
                            <Circle className="w-4 h-4 text-muted-foreground/30" />
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className={cn(
              "flex items-center gap-0 rounded-2xl w-full",
              activeTab === "transcript"
                ? "bg-neutral-100"
                : "hover:bg-white/50"
            )}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab("transcript")}
                className={cn(
                  "flex-1 justify-center gap-2 rounded-2xl border-0",
                  activeTab === "transcript"
                    ? "text-foreground hover:bg-neutral-100"
                    : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                )}
              >
                <Languages className="h-4 w-4" />
                Transcript
              </Button>
            </div>
          )}
        </div>
        {showChatTab && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("chat")}
            className={cn(
              "flex-1 justify-center gap-2 rounded-2xl",
              activeTab === "chat"
                ? "bg-neutral-100 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/50"
            )}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("notes")}
          className={cn(
            "flex-1 justify-center gap-2 rounded-2xl",
            activeTab === "notes"
              ? "bg-neutral-100 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-white/50",
            notes?.length ? undefined : "opacity-75"
          )}
        >
          <PenLine className="h-4 w-4" />
          Notes
        </Button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {/* Keep both components mounted but toggle visibility */}
        <div className={cn("absolute inset-0", activeTab !== "transcript" && "hidden")}>
          <TranscriptViewer
            transcript={transcript}
            selectedTopic={selectedTopic}
            onTimestampClick={onTimestampClick}
            currentTime={currentTime}
            topics={topics}
            citationHighlight={citationHighlight}
            onTakeNoteFromSelection={onTakeNoteFromSelection}
            videoId={videoId}
            selectedLanguage={selectedLanguage}
            onRequestTranslation={onRequestTranslation}
            onRequestExport={onRequestExport}
            exportButtonState={exportButtonState}
          />
        </div>
        <div className={cn("absolute inset-0", (activeTab !== "chat" || !showChatTab) && "hidden")}>
          <AIChat
            transcript={transcript}
            topics={topics || []}
            videoId={videoId}
            videoTitle={videoTitle}
            videoInfo={videoInfo}
            onCitationClick={onCitationClick}
            onTimestampClick={onTimestampClick}
            cachedSuggestedQuestions={cachedSuggestedQuestions}
            onSaveNote={onSaveNote}
            onTakeNoteFromSelection={onTakeNoteFromSelection}
            selectedLanguage={selectedLanguage}
            translationCache={translationCache}
            onRequestTranslation={onRequestTranslation}
          />
        </div>
        <div className={cn("absolute inset-0", activeTab !== "notes" && "hidden")}
        >
          <TooltipProvider delayDuration={0}>
            <NotesPanel
              notes={notes}
              editingNote={editingNote}
              onSaveEditingNote={onSaveEditingNote}
              onCancelEditing={onCancelEditing}
              isAuthenticated={isAuthenticated}
              onSignInClick={onRequestSignIn}
            />
          </TooltipProvider>
        </div>
      </div>
    </Card>
  );
});

RightColumnTabs.displayName = "RightColumnTabs";
