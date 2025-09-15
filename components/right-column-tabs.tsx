"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, FileEdit, Loader2 } from "lucide-react";
import { TranscriptSegment, Topic, Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SummaryViewer } from "@/components/summary-viewer";
import { Skeleton } from "@/components/ui/skeleton";

interface RightColumnTabsProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string, isWithinHighlightReel?: boolean, isWithinCitationHighlight?: boolean) => void;
  onSummaryTimestampClick?: (seconds: number) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: Citation | null;
  videoId: string;
  videoTitle?: string;
  onCitationClick: (citation: Citation) => void;
  onPlayAllCitations?: (citations: Citation[]) => void;
  summaryContent?: string | null;
  isGeneratingSummary?: boolean;
  summaryError?: string;
  showSummaryTab?: boolean;
}

export interface RightColumnTabsHandle {
  switchToTranscript: () => void;
  switchToSummary?: () => void;
}

export const RightColumnTabs = forwardRef<RightColumnTabsHandle, RightColumnTabsProps>(({
  transcript,
  selectedTopic,
  onTimestampClick,
  onSummaryTimestampClick,
  currentTime,
  topics,
  citationHighlight,
  videoId,
  videoTitle,
  onCitationClick,
  onPlayAllCitations,
  summaryContent,
  isGeneratingSummary,
  summaryError,
  showSummaryTab,
}, ref) => {
  const [activeTab, setActiveTab] = useState<"transcript" | "summary">("summary");

  // Expose methods to parent to switch tabs
  useImperativeHandle(ref, () => ({
    switchToTranscript: () => {
      setActiveTab("transcript");
    },
    switchToSummary: () => {
      if (showSummaryTab) {
        setActiveTab("summary");
      }
    }
  }));

  return (
    <Card className="h-full flex flex-col overflow-hidden p-0 gap-0">
      <div className="flex items-center gap-1 p-1.5 border-b">
        {showSummaryTab && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("summary")}
            className={cn(
              "flex-1 justify-center gap-2",
              activeTab === "summary" 
                ? "bg-accent text-accent-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isGeneratingSummary ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileEdit className="h-4 w-4" />
            )}
            Summary
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("transcript")}
          className={cn(
            "flex-1 justify-center gap-2",
            activeTab === "transcript" 
              ? "bg-accent text-accent-foreground" 
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FileText className="h-4 w-4" />
          Transcript
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
          />
        </div>
        <div className={cn("absolute inset-0", activeTab !== "summary" && "hidden")}>
          {isGeneratingSummary ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-6 w-2/3 mt-4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-6 w-1/2 mt-4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : summaryError ? (
            <div className="p-6 space-y-4">
              <p className="text-destructive">{summaryError}</p>
            </div>
          ) : summaryContent ? (
            <SummaryViewer content={summaryContent} onTimestampClick={onSummaryTimestampClick || onTimestampClick} />
          ) : null}
        </div>
      </div>
    </Card>
  );
});

RightColumnTabs.displayName = "RightColumnTabs";