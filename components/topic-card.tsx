"use client";

import { useState, useEffect } from "react";
import { Topic } from "@/lib/types";
import { formatDuration, getTopicHSLColor } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TopicCardProps {
  topic: Topic;
  isSelected: boolean;
  onClick: () => void;
  topicIndex: number;
  onPlayTopic?: () => void;
  videoId?: string;
  selectedLanguage?: string | null;
  onRequestTranslation?: (text: string, topicId: string) => Promise<string>;
}

export function TopicCard({ topic, isSelected, onClick, topicIndex, onPlayTopic, videoId, selectedLanguage = null, onRequestTranslation }: TopicCardProps) {
  const topicColor = getTopicHSLColor(topicIndex, videoId);
  const [translatedTitle, setTranslatedTitle] = useState<string | null>(topic.translatedTitle || null);
  const [isLoadingTranslation, setIsLoadingTranslation] = useState(false);

  // Request translation when language is selected and not already available
  useEffect(() => {
    const translationEnabled = selectedLanguage !== null;
    if (translationEnabled && !translatedTitle && !isLoadingTranslation && onRequestTranslation) {
      setIsLoadingTranslation(true);
      // Include language in cache key to allow caching per language
      const cacheKey = `${topic.id}:${selectedLanguage}`;
      onRequestTranslation(topic.title, cacheKey)
        .then(translation => {
          setTranslatedTitle(translation);
        })
        .catch(error => {
          console.error('Translation failed for topic:', topic.id, error);
        })
        .finally(() => {
          setIsLoadingTranslation(false);
        });
    }
  }, [selectedLanguage, translatedTitle, isLoadingTranslation, onRequestTranslation, topic.title, topic.id]);

  // Clear translation when language changes
  useEffect(() => {
    setTranslatedTitle(topic.translatedTitle || null);
    setIsLoadingTranslation(false);
  }, [selectedLanguage, topic.translatedTitle]);
  
  const handleClick = () => {
    onClick();
    // Automatically play the topic when clicked
    if (onPlayTopic) {
      onPlayTopic();
    }
  };
  
  return (
    <button
      className={cn(
        "w-full px-3 py-1.5 rounded-xl",
        "flex items-center justify-between gap-2.5",
        "transition-all duration-200",
        "hover:scale-[1.01] hover:shadow-[0px_0px_11px_0px_rgba(0,0,0,0.1)]",
        "text-left",
        isSelected && "scale-[1.01] shadow-[0px_0px_11px_0px_rgba(0,0,0,0.1)]",
      )}
      style={{
        backgroundColor: isSelected
          ? `hsl(${topicColor} / 0.15)`
          : `hsl(${topicColor} / 0.08)`,
      }}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <div
          className={cn(
            "rounded-full shrink-0 transition-all mt-0.5",
            isSelected ? "w-3.5 h-3.5" : "w-3 h-3"
          )}
          style={{ backgroundColor: `hsl(${topicColor})` }}
        />
        <div className="flex-1 min-w-0">
          {selectedLanguage !== null ? (
            <div className="space-y-0.5">
              <span className="font-medium text-sm truncate block">
                {isLoadingTranslation ? "Translating..." : translatedTitle || topic.title}
              </span>
              <span className="text-xs text-muted-foreground truncate block opacity-70">
                {topic.title}
              </span>
            </div>
          ) : (
            <span className="font-medium text-sm truncate">
              {topic.title}
            </span>
          )}
        </div>
      </div>

      <span className="font-mono text-xs text-muted-foreground shrink-0">
        {formatDuration(topic.duration)}
      </span>
    </button>
  );
}