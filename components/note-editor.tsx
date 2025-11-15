"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NoteMetadata } from "@/lib/types";
import { Send } from "lucide-react";

interface NoteEditorProps {
  selectedText: string;
  metadata?: NoteMetadata | null;
  onSave: (additionalText: string) => void;
  onCancel: () => void;
}

export function NoteEditor({ selectedText, metadata, onSave, onCancel }: NoteEditorProps) {
  const [additionalText, setAdditionalText] = useState("");

  const handleSave = () => {
    // Combine selected text with additional notes
    const fullNote = additionalText.trim()
      ? `${selectedText}\n\n${additionalText.trim()}`
      : selectedText;

    onSave(fullNote);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Save on Cmd/Ctrl + Enter
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="relative rounded-md bg-neutral-100 border border-[#ebecee] p-4 animate-in fade-in duration-200 w-full max-w-full overflow-hidden">
      {/* Quote block inside */}
      <div className="border-l-2 border-primary/40 pl-3 pr-3 py-1.5 rounded-r mb-3">
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
          {selectedText}
        </p>
      </div>

      {/* Additional notes textarea */}
      <Textarea
        value={additionalText}
        onChange={(e) => setAdditionalText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder=""
        className="resize-none text-xs bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 pr-12 min-h-[80px] px-2 py-1 max-w-full"
        rows={3}
        autoFocus
      />

      {/* Send button */}
      <Button
        onClick={handleSave}
        size="icon"
        className="absolute right-3 bottom-3 rounded-full h-8 w-8"
      >
        <Send className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
