"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TranscriptSegment, Topic } from "@/lib/types";
import { getTopicHSLColor, formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Eye, EyeOff, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { TranscriptSettings } from "@/components/transcript-settings";
import { useSettings } from "@/contexts/settings-context";
import { useLocale, useTranslations } from "next-intl";

interface TranscriptViewerProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string, isWithinHighlightReel?: boolean, isWithinCitationHighlight?: boolean) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: { start: number; end?: number; text?: string } | null;
}

export function TranscriptViewer({
  transcript,
  selectedTopic,
  onTimestampClick,
  currentTime = 0,
  topics = [],
  citationHighlight,
}: TranscriptViewerProps) {
  const t = useTranslations('transcript');
  const locale = useLocale();
  const { transcriptDisplayMode, getFromTranslationCache, addToTranslationCache } = useSettings();
  const [translations, setTranslations] = useState<Map<number, string>>(new Map());
  const [loadingTranslations, setLoadingTranslations] = useState<Set<number>>(new Set());
  const highlightedRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const currentSegmentRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToCurrentButton, setShowScrollToCurrentButton] = useState(false);
  const lastUserScrollTime = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const translationQueue = useRef<Set<number>>(new Set());
  const translationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear refs when topic changes
  useEffect(() => {
    highlightedRefs.current = [];
    
    // Debug: Verify segment indices match content
    if (selectedTopic && selectedTopic.segments.length > 0 && transcript.length > 0) {
      
      const firstSeg = selectedTopic.segments[0];
      if (firstSeg.startSegmentIdx !== undefined && firstSeg.endSegmentIdx !== undefined) {
        
        // Check what's actually at those indices
        if (transcript[firstSeg.startSegmentIdx]) {
          
          // Try to find where the quote actually is
          const quoteStart = firstSeg.text.substring(0, 30).toLowerCase().replace(/[^a-z0-9 ]/g, '');
          let foundAt = -1;
          
          for (let i = Math.max(0, firstSeg.startSegmentIdx - 5); i <= Math.min(firstSeg.startSegmentIdx + 5, transcript.length - 1); i++) {
            const segText = transcript[i]?.text || '';
            const segTextNorm = segText.toLowerCase().replace(/[^a-z0-9 ]/g, '');
            if (segTextNorm.includes(quoteStart)) {
              foundAt = i;
              break;
            }
          }
          
          if (foundAt !== -1 && foundAt !== firstSeg.startSegmentIdx) {
          }
        }
      }
    }
  }, [selectedTopic, transcript]);

  // Scroll to citation highlight when it changes
  useEffect(() => {
    if (citationHighlight && highlightedRefs.current.length > 0) {
      const firstHighlighted = highlightedRefs.current[0];
      if (firstHighlighted && scrollViewportRef.current) {
        const viewport = scrollViewportRef.current;
        const elementTop = firstHighlighted.offsetTop;
        const viewportHeight = viewport.clientHeight;
        const scrollPosition = elementTop - viewportHeight / 3; // Position in upper third
        
        viewport.scrollTo({
          top: scrollPosition,
          behavior: 'smooth'
        });
        
        // Temporarily disable auto-scroll
        lastUserScrollTime.current = Date.now();
      }
    }
  }, [citationHighlight]);

  // Detect user scroll and temporarily disable auto-scroll with debouncing
  const handleUserScroll = useCallback(() => {
    const now = Date.now();
    // Only consider it user scroll if enough time has passed since last programmatic scroll
    if (now - lastUserScrollTime.current > 300) {
      if (autoScroll) {
        setAutoScroll(false);
        setShowScrollToCurrentButton(true);
        
        // Clear existing timeout
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        
        // Re-enable auto-scroll after 8 seconds of inactivity for better UX
        scrollTimeoutRef.current = setTimeout(() => {
          setAutoScroll(true);
          setShowScrollToCurrentButton(false);
        }, 8000);
      }
    }
  }, [autoScroll]);

  // Custom scroll function that only scrolls within the container
  const scrollToElement = useCallback((element: HTMLElement | null, smooth = true) => {
    if (!element || !scrollViewportRef.current) return;
    
    const viewport = scrollViewportRef.current;
    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    
    // Calculate the element's position relative to the viewport
    const relativeTop = elementRect.top - viewportRect.top + viewport.scrollTop;
    
    // Center the element in the viewport with improved calculation
    const scrollPosition = relativeTop - (viewportRect.height / 2) + (elementRect.height / 2);
    
    // Mark this as programmatic scroll
    lastUserScrollTime.current = Date.now() + 500; // Add buffer to prevent detecting as user scroll
    
    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      viewport.scrollTo({
        top: Math.max(0, scrollPosition),
        behavior: smooth ? 'smooth' : 'auto'
      });
    });
  }, []);

  const jumpToCurrent = useCallback(() => {
    if (currentSegmentRef.current) {
      setAutoScroll(true);
      setShowScrollToCurrentButton(false);
      scrollToElement(currentSegmentRef.current);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    }
  }, [scrollToElement]);

  // Scroll to first highlighted segment
  useEffect(() => {
    if (selectedTopic && highlightedRefs.current[0] && autoScroll) {
      setTimeout(() => {
        scrollToElement(highlightedRefs.current[0]);
      }, 100);
    }
  }, [selectedTopic, autoScroll, scrollToElement]);

  // Auto-scroll to current playing segment with improved smooth tracking
  useEffect(() => {
    if (autoScroll && currentSegmentRef.current && currentTime > 0) {
      // Check if current segment is visible
      const viewport = scrollViewportRef.current;
      if (viewport) {
        const element = currentSegmentRef.current;
        const elementRect = element.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        
        // Improved thresholds for better centering - check if element is outside the center 40% of viewport
        const topThreshold = viewportRect.top + viewportRect.height * 0.35;
        const bottomThreshold = viewportRect.top + viewportRect.height * 0.65;
        
        // Also check if element is completely out of view
        const isOutOfView = elementRect.bottom < viewportRect.top || elementRect.top > viewportRect.bottom;
        
        if (isOutOfView || elementRect.top < topThreshold || elementRect.bottom > bottomThreshold) {
          scrollToElement(currentSegmentRef.current, true);
        }
      }
    }
  }, [currentTime, autoScroll, scrollToElement]);

  // Translation functions
  const fetchTranslation = useCallback(async (segmentIndex: number, text: string) => {
    if (locale === 'en') return; // Don't translate if already in English
    
    const cacheKey = `${segmentIndex}-${locale}`;
    const cached = getFromTranslationCache(cacheKey);
    if (cached) {
      setTranslations(prev => new Map(prev).set(segmentIndex, cached));
      return;
    }

    setLoadingTranslations(prev => new Set(prev).add(segmentIndex));
    
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage: locale }),
      });
      
      if (response.ok) {
        const { translation } = await response.json();
        addToTranslationCache(cacheKey, translation);
        setTranslations(prev => new Map(prev).set(segmentIndex, translation));
      }
    } catch (error) {
      console.error('Translation error:', error);
    } finally {
      setLoadingTranslations(prev => {
        const newSet = new Set(prev);
        newSet.delete(segmentIndex);
        return newSet;
      });
    }
  }, [locale, getFromTranslationCache, addToTranslationCache]);

  // Batch translation loading
  useEffect(() => {
    if (transcriptDisplayMode === 'sideBySide' && locale !== 'en') {
      // Clear previous timeout
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current);
      }

      // Debounce translation requests
      translationTimeoutRef.current = setTimeout(() => {
        // Get visible segments
        const viewport = scrollViewportRef.current;
        if (!viewport) return;

        const viewportRect = viewport.getBoundingClientRect();
        const visibleSegments: number[] = [];

        transcript.forEach((segment, idx) => {
          const element = document.getElementById(`segment-${idx}`);
          if (element) {
            const rect = element.getBoundingClientRect();
            if (rect.bottom >= viewportRect.top && rect.top <= viewportRect.bottom) {
              visibleSegments.push(idx);
            }
          }
        });

        // Load translations for visible segments
        visibleSegments.forEach(idx => {
          if (!translations.has(idx) && !loadingTranslations.has(idx)) {
            fetchTranslation(idx, transcript[idx].text);
          }
        });
      }, 300);
    }

    return () => {
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current);
      }
    };
  }, [transcript, transcriptDisplayMode, locale, translations, loadingTranslations, fetchTranslation]);

  // Add scroll event listener
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      viewport.addEventListener('scroll', handleUserScroll);
      return () => {
        viewport.removeEventListener('scroll', handleUserScroll);
      };
    }
  }, [handleUserScroll]);

  const getSegmentTopic = (segment: TranscriptSegment): { topic: Topic; index: number } | null => {
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const hasSegment = topic.segments.some(
        (topicSeg) => segment.start >= topicSeg.start && segment.start < topicSeg.end
      );
      if (hasSegment) {
        return { topic, index: i };
      }
    }
    return null;
  };

  const isSegmentHighlighted = (segment: TranscriptSegment): boolean => {
    if (!selectedTopic) return false;
    return selectedTopic.segments.some(
      (topicSeg) => segment.start >= topicSeg.start && segment.start < topicSeg.end
    );
  };

  const getHighlightedText = (segment: TranscriptSegment, segmentIndex: number): { highlightedParts: Array<{ text: string; highlighted: boolean }> } | null => {
    if (!selectedTopic) return null;
    
    // Check each topic segment to see if this transcript segment should be highlighted
    for (const topicSeg of selectedTopic.segments) {
      // Use segment indices with character offsets for precise matching
      if (topicSeg.startSegmentIdx !== undefined && topicSeg.endSegmentIdx !== undefined) {
        
        // Skip this debug logging - removed for cleaner output
        
        // Skip segments that are before the start or after the end
        if (segmentIndex < topicSeg.startSegmentIdx || segmentIndex > topicSeg.endSegmentIdx) {
          continue;
        }
        
        // Case 1: This segment is between start and end (not at boundaries)
        if (segmentIndex > topicSeg.startSegmentIdx && segmentIndex < topicSeg.endSegmentIdx) {
          return { 
            highlightedParts: [{ text: segment.text, highlighted: true }] 
          };
        }
        
        // Case 2: This is the start segment - may need partial highlighting
        if (segmentIndex === topicSeg.startSegmentIdx) {
          if (topicSeg.startCharOffset !== undefined && topicSeg.startCharOffset > 0) {
            // Partial highlight from character offset to end
            const beforeHighlight = segment.text.substring(0, topicSeg.startCharOffset);
            const highlighted = segment.text.substring(topicSeg.startCharOffset);
            
            // If this is also the end segment, apply end offset
            if (segmentIndex === topicSeg.endSegmentIdx && topicSeg.endCharOffset !== undefined) {
              const actualHighlighted = segment.text.substring(
                topicSeg.startCharOffset, 
                Math.min(topicSeg.endCharOffset, segment.text.length)
              );
              const afterHighlight = segment.text.substring(Math.min(topicSeg.endCharOffset, segment.text.length));
              
              const parts: Array<{ text: string; highlighted: boolean }> = [];
              if (beforeHighlight) parts.push({ text: beforeHighlight, highlighted: false });
              if (actualHighlighted) parts.push({ text: actualHighlighted, highlighted: true });
              if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
              return { highlightedParts: parts };
            }
            
            const parts: Array<{ text: string; highlighted: boolean }> = [];
            if (beforeHighlight) parts.push({ text: beforeHighlight, highlighted: false });
            if (highlighted) parts.push({ text: highlighted, highlighted: true });
            return { highlightedParts: parts };
          } else {
            // No offset or offset is 0, highlight from beginning
            if (segmentIndex === topicSeg.endSegmentIdx && topicSeg.endCharOffset !== undefined) {
              // This is both start and end segment
              const highlighted = segment.text.substring(0, topicSeg.endCharOffset);
              const afterHighlight = segment.text.substring(topicSeg.endCharOffset);
              
              const parts: Array<{ text: string; highlighted: boolean }> = [];
              if (highlighted) parts.push({ text: highlighted, highlighted: true });
              if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
              return { highlightedParts: parts };
            }
            // Highlight entire segment
            return { 
              highlightedParts: [{ text: segment.text, highlighted: true }] 
            };
          }
        }
        
        // Case 3: This is the end segment (only if different from start) - may need partial highlighting
        if (segmentIndex === topicSeg.endSegmentIdx && segmentIndex !== topicSeg.startSegmentIdx) {
          if (topicSeg.endCharOffset !== undefined && topicSeg.endCharOffset < segment.text.length) {
            // Partial highlight from beginning to character offset
            const highlighted = segment.text.substring(0, topicSeg.endCharOffset);
            const afterHighlight = segment.text.substring(topicSeg.endCharOffset);
            
            const parts: Array<{ text: string; highlighted: boolean }> = [];
            if (highlighted) parts.push({ text: highlighted, highlighted: true });
            if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
            return { highlightedParts: parts };
          } else {
            // No offset or offset covers entire segment
            return { 
              highlightedParts: [{ text: segment.text, highlighted: true }] 
            };
          }
        }
      }
    }
    
    // Only use time-based highlighting if NO segments have index information
    const hasAnySegmentIndices = selectedTopic.segments.some(seg => 
      seg.startSegmentIdx !== undefined && seg.endSegmentIdx !== undefined
    );
    
    if (!hasAnySegmentIndices) {
      // Fallback to time-based highlighting only if segment indices aren't available at all
      const segmentEnd = segment.start + segment.duration;
      const shouldHighlight = selectedTopic.segments.some(topicSeg => {
        const overlapStart = Math.max(segment.start, topicSeg.start);
        const overlapEnd = Math.min(segmentEnd, topicSeg.end);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);
        const overlapRatio = overlapDuration / segment.duration;
        // Highlight if there's significant overlap (more than 50% of the segment)
        return overlapRatio > 0.5;
      });
      
      if (shouldHighlight) {
        return { 
          highlightedParts: [{ text: segment.text, highlighted: true }] 
        };
      }
    }
    
    return null;
  };
  
  

  const getCitationHighlightedText = (segment: TranscriptSegment, segmentIndex: number): { highlightedParts: Array<{ text: string; highlighted: boolean; isCitation: boolean }> } | null => {
    if (!citationHighlight) return null;
    
    const segmentEnd = segment.start + segment.duration;
    const citationEnd = citationHighlight.end || citationHighlight.start + 30;
    
    // Check if segment overlaps with citation time range
    const overlapStart = Math.max(segment.start, citationHighlight.start);
    const overlapEnd = Math.min(segmentEnd, citationEnd);
    const overlapDuration = Math.max(0, overlapEnd - overlapStart);
    const overlapRatio = overlapDuration / segment.duration;
    
    // For citations, we can be more lenient with partial overlaps
    // since we don't have character-level offsets for citations yet
    if (overlapRatio > 0.5) {
      // Try to find sentence boundaries within the segment
      // This is a simplified approach for citations
      const sentences = segment.text.split(/(?<=[.!?])\s+/);
      if (sentences.length > 1 && overlapRatio < 0.9) {
        // Partial segment - try to highlight only relevant sentences
        const parts: Array<{ text: string; highlighted: boolean; isCitation: boolean }> = [];
        let currentPos = 0;
        
        for (const sentence of sentences) {
          const sentenceStart = segment.text.indexOf(sentence, currentPos);
          if (sentenceStart === -1) continue;
          
          // Estimate time position of this sentence within the segment
          const sentenceTimeRatio = sentenceStart / segment.text.length;
          const sentenceTime = segment.start + (segment.duration * sentenceTimeRatio);
          
          // Check if this sentence falls within citation range
          const shouldHighlight = sentenceTime >= citationHighlight.start && sentenceTime <= citationEnd;
          
          if (shouldHighlight) {
            // Add any text before this sentence as non-highlighted
            if (sentenceStart > currentPos) {
              parts.push({ 
                text: segment.text.substring(currentPos, sentenceStart), 
                highlighted: false, 
                isCitation: false 
              });
            }
            parts.push({ text: sentence, highlighted: true, isCitation: true });
          } else if (parts.length === 0) {
            // Haven't started highlighting yet
            parts.push({ text: sentence, highlighted: false, isCitation: false });
          }
          
          currentPos = sentenceStart + sentence.length;
        }
        
        // Add any remaining text
        if (currentPos < segment.text.length && parts.length > 0) {
          parts.push({ 
            text: segment.text.substring(currentPos), 
            highlighted: false, 
            isCitation: false 
          });
        }
        
        if (parts.some(p => p.highlighted)) {
          return { highlightedParts: parts };
        }
      } else {
        // Highlight entire segment
        return { 
          highlightedParts: [{ text: segment.text, highlighted: true, isCitation: true }] 
        };
      }
    }
    
    return null;
  };
  
  const isCitationHighlighted = (segment: TranscriptSegment, segmentIndex: number): boolean => {
    return getCitationHighlightedText(segment, segmentIndex) !== null;
  };

  // Find the single best matching segment for the current time
  const getCurrentSegmentIndex = (): number => {
    if (currentTime === 0) return -1;
    
    // Find all segments that contain the current time
    const matchingIndices: number[] = [];
    transcript.forEach((segment, index) => {
      if (currentTime >= segment.start && currentTime < segment.start + segment.duration) {
        matchingIndices.push(index);
      }
    });
    
    // If no matches, return -1
    if (matchingIndices.length === 0) return -1;
    
    // If only one match, return it
    if (matchingIndices.length === 1) return matchingIndices[0];
    
    // If multiple matches, return the one whose start time is closest to current time
    return matchingIndices.reduce((closest, current) => {
      const closestDiff = Math.abs(transcript[closest].start - currentTime);
      const currentDiff = Math.abs(transcript[current].start - currentTime);
      return currentDiff < closestDiff ? current : closest;
    });
  };

  const handleSegmentClick = useCallback(
    (segment: TranscriptSegment, isTopicHighlighted: boolean, isCitationHighlighted: boolean) => {
      // Check if this segment is within the current highlight reel
      const isWithinHighlightReel = selectedTopic ? isTopicHighlighted : undefined;
      // Check if this segment is within a citation highlight
      const isWithinCitationHighlight = citationHighlight ? isCitationHighlighted : undefined;
      onTimestampClick(segment.start, undefined, false, undefined, isWithinHighlightReel, isWithinCitationHighlight);
    },
    [onTimestampClick, selectedTopic, citationHighlight]
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full max-h-full flex flex-col rounded-lg border bg-card shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">{t('title')}</h3>
          </div>
          <div className="flex items-center gap-2">
            <TranscriptSettings />
            <Button
              variant={autoScroll ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setAutoScroll(!autoScroll);
                if (!autoScroll) {
                  setShowScrollToCurrentButton(false);
                  jumpToCurrent();
                }
              }}
              className="text-xs h-7"
            >
              {autoScroll ? (
                <>
                  <Eye className="w-3 h-3 mr-1" />
                  Auto
                </>
              ) : (
                <>
                  <EyeOff className="w-3 h-3 mr-1" />
                  Manual
                </>
              )}
            </Button>
          </div>
        </div>
        {selectedTopic && (
          <div className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))})`,
              }}
            />
            <span className="text-xs text-muted-foreground truncate">
              Highlighting: {selectedTopic.title}
            </span>
          </div>
        )}
      </div>

      {/* Jump to current button with improved positioning */}
      {showScrollToCurrentButton && currentTime > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 animate-in fade-in slide-in-from-top-2 duration-300">
          <Button
            size="sm"
            onClick={jumpToCurrent}
            className="shadow-lg bg-primary/95 hover:bg-primary"
          >
            <ChevronDown className="w-4 h-4 mr-1 animate-bounce" />
            Jump to Current
          </Button>
        </div>
      )}

      {/* Transcript content */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
        <div 
          className="p-4 space-y-1" 
          ref={(el) => {
            // Get the viewport element from ScrollArea - it's the data-radix-scroll-area-viewport element
            if (el) {
              const viewport = el.closest('[data-radix-scroll-area-viewport]');
              if (viewport && viewport instanceof HTMLElement) {
                scrollViewportRef.current = viewport as HTMLDivElement;
              }
            }
          }}
        >
          {transcript.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No transcript available
            </div>
          ) : (
            (() => {
              // Calculate current segment index once for all segments
              const currentSegmentIndex = getCurrentSegmentIndex();
              
              return transcript.map((segment, index) => {
                const topicHighlightedText = getHighlightedText(segment, index);
                const citationHighlightedText = getCitationHighlightedText(segment, index);
                const isCurrent = index === currentSegmentIndex;
                const topicInfo = getSegmentTopic(segment);
                const isHovered = hoveredSegment === index;
                
                // Track highlight states separately
                const hasTopicHighlight = topicHighlightedText !== null;
                const hasCitationHighlight = citationHighlightedText !== null;
                
                // Merge highlights if both exist
                let finalHighlightedParts: Array<{ text: string; highlighted: boolean; isCitation?: boolean }> | null = null;
                
                if (citationHighlightedText) {
                  // Citation takes priority
                  finalHighlightedParts = citationHighlightedText.highlightedParts;
                } else if (topicHighlightedText) {
                  // Use topic highlights
                  finalHighlightedParts = topicHighlightedText.highlightedParts.map(part => ({
                    ...part,
                    isCitation: false
                  }));
                }
                
                const hasHighlight = finalHighlightedParts !== null;

            return (
              <Tooltip key={index} delayDuration={300}>
                <TooltipTrigger asChild>
                  <div
                    id={`segment-${index}`}
                    ref={(el) => {
                      // Store refs properly
                      if (el) {
                        if (hasHighlight && !highlightedRefs.current.includes(el)) {
                          highlightedRefs.current.push(el);
                        }
                        if (isCurrent) {
                          currentSegmentRef.current = el;
                        }
                      }
                    }}
                    className={cn(
                      "group relative px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer select-none",
                      "hover:bg-muted/50",
                      isHovered && "bg-muted"
                    )}
                    onClick={() => handleSegmentClick(segment, hasTopicHighlight, hasCitationHighlight)}
                    onMouseEnter={() => {
                      setHoveredSegment(index);
                      // Load translation on hover in overlay mode
                      if (transcriptDisplayMode === 'overlay' && locale !== 'en' && !translations.has(index) && !loadingTranslations.has(index)) {
                        fetchTranslation(index, segment.text);
                      }
                    }}
                    onMouseLeave={() => setHoveredSegment(null)}
                  >
                    {/* Play indicator on hover */}
                    {isHovered && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="w-4 h-4 text-primary" />
                      </div>
                    )}


                    {/* Bilingual text display */}
                    {transcriptDisplayMode === 'sideBySide' && locale !== 'en' && (
                      <div className="space-y-1 mb-1">
                        {/* Translation */}
                        <p className={cn(
                          "text-sm leading-relaxed",
                          isCurrent ? "text-foreground font-medium" : "text-foreground/90"
                        )}>
                          {loadingTranslations.has(index) ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Loading translation...
                            </span>
                          ) : (
                            translations.get(index) || segment.text
                          )}
                        </p>
                        {/* Original English with highlighting */}
                        <p className={cn(
                          "text-xs leading-relaxed italic",
                          isCurrent ? "text-muted-foreground/80" : "text-muted-foreground/60"
                        )}>
                          {finalHighlightedParts ? (
                            finalHighlightedParts.map((part, partIndex) => {
                              const isCitation = 'isCitation' in part && part.isCitation;
                              return (
                                <span
                                  key={partIndex}
                                  className={part.highlighted ? "text-muted-foreground" : ""}
                                  style={
                                    part.highlighted
                                      ? isCitation
                                        ? {
                                            backgroundColor: 'hsl(48, 100%, 85%, 0.5)',
                                            padding: '1px 3px',
                                            borderRadius: '3px',
                                          }
                                        : selectedTopic
                                        ? {
                                            backgroundColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))} / 0.15)`,
                                            padding: '0 2px',
                                            borderRadius: '2px',
                                          }
                                        : undefined
                                      : undefined
                                  }
                                >
                                  {part.text}
                                </span>
                              );
                            })
                          ) : (
                            segment.text
                          )}
                        </p>
                      </div>
                    )}
                    
                    {/* Original display mode or English locale */}
                    {(transcriptDisplayMode === 'original' || locale === 'en') && (
                      <p 
                        className={cn(
                          "text-sm leading-relaxed",
                          isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                        )}
                      >
                        {finalHighlightedParts ? (
                          finalHighlightedParts.map((part, partIndex) => {
                            const isCitation = 'isCitation' in part && part.isCitation;
                            
                            return (
                              <span
                                key={partIndex}
                                className={part.highlighted ? "text-foreground" : ""}
                                style={
                                  part.highlighted
                                    ? isCitation
                                      ? {
                                          backgroundColor: 'hsl(48, 100%, 85%)',
                                          padding: '1px 3px',
                                          borderRadius: '3px',
                                          boxShadow: '0 0 0 1px hsl(48, 100%, 50%, 0.3)',
                                        }
                                      : selectedTopic
                                      ? {
                                          backgroundColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))} / 0.2)`,
                                          padding: '0 2px',
                                          borderRadius: '2px',
                                        }
                                      : undefined
                                    : undefined
                                }
                              >
                                {part.text}
                              </span>
                            );
                          })
                        ) : (
                          segment.text
                        )}
                      </p>
                    )}
                    
                    {/* Overlay mode */}
                    {transcriptDisplayMode === 'overlay' && locale !== 'en' && (
                      <div className="relative group/overlay">
                        <p 
                          className={cn(
                            "text-sm leading-relaxed",
                            isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                          )}
                        >
                          {finalHighlightedParts ? (
                            finalHighlightedParts.map((part, partIndex) => {
                              const isCitation = 'isCitation' in part && part.isCitation;
                              
                              return (
                                <span
                                  key={partIndex}
                                  className={part.highlighted ? "text-foreground" : ""}
                                  style={
                                    part.highlighted
                                      ? isCitation
                                        ? {
                                            backgroundColor: 'hsl(48, 100%, 85%)',
                                            padding: '1px 3px',
                                            borderRadius: '3px',
                                            boxShadow: '0 0 0 1px hsl(48, 100%, 50%, 0.3)',
                                          }
                                      : selectedTopic
                                      ? {
                                          backgroundColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))} / 0.2)`,
                                          padding: '0 2px',
                                          borderRadius: '2px',
                                        }
                                      : undefined
                                    : undefined
                                }
                              >
                                {part.text}
                              </span>
                            );
                          })
                        ) : (
                          segment.text
                        )}
                      </p>
                      {/* Hover translation tooltip */}
                      <div className="absolute left-0 right-0 top-full mt-1 z-10 opacity-0 pointer-events-none group-hover/overlay:opacity-100 group-hover/overlay:pointer-events-auto transition-opacity">
                        <div className="bg-popover border rounded-md p-2 shadow-lg">
                          <p className="text-sm text-foreground">
                            {loadingTranslations.has(index) ? (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading translation...
                              </span>
                            ) : (
                              translations.get(index) || 'Hover to load translation...'
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-xs">
                  {formatDuration(segment.start)} - {formatDuration(segment.start + segment.duration)}
                </TooltipContent>
              </Tooltip>
            );
          });
            })()
          )}
        </div>
      </ScrollArea>
    </div>
    </TooltipProvider>
  );
}