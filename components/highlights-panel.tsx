"use client";

import { useState, useEffect } from "react";
import { Topic, TranscriptSegment, TranslationRequestHandler } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VideoProgressBar } from "@/components/video-progress-bar";
import { formatDuration, cn } from "@/lib/utils";
import { Play, Pause, Loader2 } from "lucide-react";

// Default English labels
const DEFAULT_LABELS = {
  playAll: "Play All",
  stop: "Stop",
  generatingYourReels: "Generating your reels...",
};

interface HighlightsPanelProps {
  topics: Topic[];
  selectedTopic: Topic | null;
  onTopicSelect: (topic: Topic) => void;
  onPlayTopic?: (topic: Topic) => void;
  onSeek: (time: number) => void;
  onPlayAll: () => void;
  isPlayingAll: boolean;
  playAllIndex?: number;
  currentTime: number;
  videoDuration: number;
  transcript?: TranscriptSegment[];
  isLoadingThemeTopics?: boolean;
  videoId?: string;
  selectedLanguage?: string | null;
  onRequestTranslation?: TranslationRequestHandler;
}

export function HighlightsPanel({
  topics,
  selectedTopic,
  onTopicSelect,
  onPlayTopic,
  onSeek,
  onPlayAll,
  isPlayingAll,
  playAllIndex = 0,
  currentTime,
  videoDuration,
  transcript = [],
  isLoadingThemeTopics = false,
  videoId,
  selectedLanguage = null,
  onRequestTranslation,
}: HighlightsPanelProps) {
  // Translation state
  const [translatedLabels, setTranslatedLabels] = useState(DEFAULT_LABELS);

  // Translate labels when language changes
  useEffect(() => {
    if (!selectedLanguage || !onRequestTranslation) {
      setTranslatedLabels(DEFAULT_LABELS);
      return;
    }

    let isCancelled = false;

    const translateLabels = async () => {
      const translations = await Promise.all([
        onRequestTranslation(DEFAULT_LABELS.playAll, `ui_highlights:playAll:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.stop, `ui_highlights:stop:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.generatingYourReels, `ui_highlights:generatingYourReels:${selectedLanguage}`),
      ]);

      if (!isCancelled) {
        setTranslatedLabels({
          playAll: translations[0],
          stop: translations[1],
          generatingYourReels: translations[2],
        });
      }
    };

    translateLabels().catch((err) => {
      console.error("Failed to translate highlights panel labels:", err);
      if (!isCancelled) {
        setTranslatedLabels(DEFAULT_LABELS);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedLanguage, onRequestTranslation]);

  return (
    <Card className="overflow-hidden p-0 border-0 relative">
      <div className={cn(
        "p-2.5 bg-background rounded-b-3xl flex-shrink-0 transition-all duration-200",
        isLoadingThemeTopics && "blur-[4px] opacity-50 pointer-events-none"
      )}>
        <VideoProgressBar
          videoDuration={videoDuration}
          currentTime={currentTime}
          topics={topics}
          selectedTopic={selectedTopic}
          onSeek={onSeek}
          onTopicSelect={(topic) => onTopicSelect(topic)}
          onPlayTopic={onPlayTopic}
          transcript={transcript}
          isLoadingThemeTopics={isLoadingThemeTopics}
          videoId={videoId}
          selectedLanguage={selectedLanguage}
          onRequestTranslation={onRequestTranslation}
        />

        <div className="mt-3 flex items-center justify-between">
          <div className="ml-2.5 flex items-center gap-1.5">
            <span className="text-xs font-mono text-muted-foreground">
              {formatDuration(currentTime)} / {formatDuration(videoDuration)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={isPlayingAll ? "secondary" : "default"}
              onClick={onPlayAll}
              className="h-7 text-xs"
            >
              {isPlayingAll ? (
                <>
                  <Pause className="h-3 w-3 mr-1" />
                  {translatedLabels.stop}
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  {translatedLabels.playAll}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {isLoadingThemeTopics && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 pointer-events-none">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">
            {translatedLabels.generatingYourReels}
          </p>
        </div>
      )}
    </Card>
  );
}
