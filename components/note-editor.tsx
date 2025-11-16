"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NoteMetadata } from "@/lib/types";
import { enhanceNoteQuote } from "@/lib/notes-client";
import { toast } from "sonner";
import { Send, Sparkles, Loader2, RotateCcw, Check } from "lucide-react";

interface NoteEditorProps {
  selectedText: string;
  metadata?: NoteMetadata | null;
  onSave: (payload: { noteText: string; selectedText: string }) => void;
  onCancel: () => void;
}

export function NoteEditor({ selectedText, onSave }: NoteEditorProps) {
  const [originalQuote, setOriginalQuote] = useState(selectedText.trim());
  const [quoteText, setQuoteText] = useState(selectedText.trim());
  const [additionalText, setAdditionalText] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [hasEnhanced, setHasEnhanced] = useState(false);

  useEffect(() => {
    const trimmed = selectedText.trim();
    setOriginalQuote(trimmed);
    setQuoteText(trimmed);
    setHasEnhanced(false);
    setAdditionalText("");
  }, [selectedText]);

  const handleSave = useCallback(() => {
    const baseQuote = (quoteText || originalQuote).trim();
    const noteParts: string[] = [];

    if (baseQuote.length > 0) {
      noteParts.push(baseQuote);
    }

    if (additionalText.trim().length > 0) {
      noteParts.push(additionalText.trim());
    }

    if (noteParts.length === 0) {
      toast.error("Nothing to save yet");
      return;
    }

    onSave({
      noteText: noteParts.join("\n\n"),
      selectedText: baseQuote || originalQuote,
    });
  }, [additionalText, onSave, originalQuote, quoteText]);

  const handleEnhance = useCallback(async () => {
    if (isEnhancing || !quoteText.trim()) {
      return;
    }

    setIsEnhancing(true);
    try {
      const cleaned = await enhanceNoteQuote(quoteText.trim());
      setQuoteText(cleaned);
      setHasEnhanced(true);
      toast.success("Selected text cleaned");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to enhance note";
      toast.error(message);
    } finally {
      setIsEnhancing(false);
    }
  }, [isEnhancing, quoteText]);

  const handleResetQuote = useCallback(() => {
    setQuoteText(originalQuote);
    setHasEnhanced(false);
  }, [originalQuote]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const enhancementDisabled = isEnhancing || !quoteText.trim();

  return (
    <div className="relative rounded-xl bg-neutral-100 border border-[#ebecee] p-4 animate-in fade-in duration-200 w-full max-w-full overflow-hidden">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.17em] text-muted-foreground/80 mb-1">
        <span>Selected Snippet</span>
        {hasEnhanced && !isEnhancing && (
          <span className="flex items-center gap-1 text-emerald-600 font-medium normal-case tracking-[0.05em]">
            <Check className="w-3 h-3" />
            Cleaned
          </span>
        )}
      </div>

      <div className="border-l-2 border-primary/40 bg-white/60 pl-3 pr-3 py-2 mb-3">
        <Textarea
          value={quoteText}
          onChange={(e) => setQuoteText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Edit the snippet before saving"
          className="resize-none border-none bg-transparent px-0 py-0 text-sm text-foreground/90 leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-none whitespace-pre-wrap break-words min-h-[72px]"
          aria-label="Selected snippet editor"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <Button
          type="button"
          variant="pill"
          size="sm"
          onClick={handleEnhance}
          disabled={enhancementDisabled}
          className="h-7 rounded-full px-3 text-xs"
        >
          {isEnhancing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Enhancing…
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              Enhance with AI
            </>
          )}
        </Button>
        {hasEnhanced ? (
          <button
            type="button"
            onClick={handleResetQuote}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset to original
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Removes filler words & typos
          </span>
        )}
      </div>

      <Textarea
        value={additionalText}
        onChange={(e) => setAdditionalText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add context or your own takeaway (optional)"
        className="resize-none text-xs bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 pr-12 min-h-[90px] px-2 py-2 max-w-full"
        rows={4}
        autoFocus
      />

      <Button
        type="button"
        onClick={handleSave}
        size="icon"
        className="absolute right-3 bottom-3 rounded-full h-8 w-8"
      >
        <Send className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
