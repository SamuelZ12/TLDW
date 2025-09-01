"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { UrlInput } from "@/components/url-input";
import { TopicCard } from "@/components/topic-card";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { YouTubePlayer } from "@/components/youtube-player";
import { AIChat } from "@/components/ai-chat";
import { ModelSelector, type GeminiModel } from "@/components/model-selector";
import { LoadingContext } from "@/components/loading-context";
import { LoadingTips } from "@/components/loading-tips";
import { Topic, TranscriptSegment, VideoInfo } from "@/lib/types";
import { extractVideoId } from "@/lib/utils";
import { Loader2, Video, FileText, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LanguageToggle } from "@/components/language-toggle";

export default function Home() {
  const t = useTranslations('app');
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<'fetching' | 'understanding' | 'generating'>('fetching');
  const [error, setError] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [seekToTime, setSeekToTime] = useState<number | undefined>();
  const [currentTime, setCurrentTime] = useState(0);
  const [transcriptHeight, setTranscriptHeight] = useState<string>("auto");
  const [selectedModel, setSelectedModel] = useState<GeminiModel>('gemini-2.5-flash');
  const [citationHighlight, setCitationHighlight] = useState<{ start: number; end?: number; text?: string } | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // Timer effect for tracking generation time
  useEffect(() => {
    if (generationStartTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - generationStartTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [generationStartTime]);

  const processVideo = async (url: string) => {
    setIsLoading(true);
    setLoadingStage('fetching');
    setError("");
    setVideoInfo(null);
    setVideoPreview("");
    
    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error(t('error.invalidUrl'));
      }
      
      setVideoId(extractedVideoId);
      
      // Fetch video info immediately (non-blocking)
      fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
        .then(res => res.json())
        .then(data => {
          if (data && !data.error) {
            setVideoInfo(data);
          }
        })
        .catch(() => {});
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      // Fetch transcript
      const transcriptRes = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      }).catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error(t('error.timeout'));
        }
        throw new Error(t('error.networkError'));
      });
      
      clearTimeout(timeoutId);
      
      if (!transcriptRes.ok) {
        const errorData = await transcriptRes.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || t('error.failedTranscript'));
      }
      
      const { transcript: fetchedTranscript } = await transcriptRes.json();
      setTranscript(fetchedTranscript);
      
      // Move to understanding stage
      setLoadingStage('understanding');
      
      // Generate quick preview (non-blocking)
      fetch("/api/quick-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          transcript: fetchedTranscript,
          videoTitle: videoInfo?.title,
          targetLanguage: locale
        }),
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.preview) {
            setVideoPreview(data.preview);
          }
        })
        .catch(() => {});
      
      // Generate topics with timeout
      setLoadingStage('generating');
      setGenerationStartTime(Date.now());
      setElapsedTime(0);
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 600000); // 60 second timeout for AI generation
      
      const topicsRes = await fetch("/api/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          transcript: fetchedTranscript,
          videoId: extractedVideoId,
          model: selectedModel,
          targetLanguage: locale
        }),
        signal: controller2.signal,
      }).catch(err => {
        clearTimeout(timeoutId2);
        if (err.name === 'AbortError') {
          throw new Error(t('error.topicTimeout'));
        }
        throw new Error(t('error.networkError'));
      });
      
      clearTimeout(timeoutId2);
      
      if (!topicsRes.ok) {
        const errorData = await topicsRes.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || t('error.failedTopics'));
      }
      
      const { topics: generatedTopics } = await topicsRes.json();
      setTopics(generatedTopics);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
      setGenerationStartTime(null);
      setElapsedTime(0);
    }
  };

  const handleTimestampClick = (seconds: number, endSeconds?: number, isCitation: boolean = false, citationText?: string, isWithinHighlightReel: boolean = false, isWithinCitationHighlight: boolean = false) => {
    // Prevent rapid sequential clicks and state updates
    if (seekToTime === seconds) return;
    
    // Handle topic selection clearing:
    // Clear topic if it's a new citation click from AI chat OR
    // if clicking outside the current highlight reel (and not within a citation)
    if (isCitation || (!isWithinHighlightReel && !isWithinCitationHighlight)) {
      setSelectedTopic(null);
    }
    
    // Handle citation highlight:
    if (isCitation) {
      // New citation from AI chat - set new citation highlight
      setCitationHighlight({ start: seconds, end: endSeconds, text: citationText });
    } else if (!isWithinCitationHighlight) {
      // Clicking outside citation highlight - clear it
      setCitationHighlight(null);
    }
    // If isWithinCitationHighlight is true, preserve the existing citation highlight
    
    // Scroll to video player
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      videoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    // Seek video to timestamp
    setSeekToTime(seconds);
    
    // Clear seek state after a short delay
    setTimeout(() => {
      setSeekToTime(undefined);
    }, 100);
  };

  const handleTimeUpdate = (seconds: number) => {
    setCurrentTime(seconds);
  };

  const handleTopicSelect = (topic: Topic | null) => {
    // Clear citation highlight when selecting a topic
    setCitationHighlight(null);
    setSelectedTopic(topic);
  };

  const handlePlayTopic = () => {
    if (selectedTopic && selectedTopic.segments.length > 0) {
      setSeekToTime(selectedTopic.segments[0].start);
    }
  };

  // Dynamically adjust transcript height to match video container
  useEffect(() => {
    const adjustTranscriptHeight = () => {
      const videoContainer = document.getElementById("video-container");
      const transcriptContainer = document.getElementById("transcript-container");
      
      if (videoContainer && transcriptContainer) {
        const videoHeight = videoContainer.offsetHeight;
        setTranscriptHeight(`${videoHeight}px`);
      }
    };

    // Initial adjustment
    adjustTranscriptHeight();

    // Adjust on window resize
    window.addEventListener("resize", adjustTranscriptHeight);
    
    // Also observe video container for size changes
    const resizeObserver = new ResizeObserver(adjustTranscriptHeight);
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      resizeObserver.observe(videoContainer);
    }

    return () => {
      window.removeEventListener("resize", adjustTranscriptHeight);
      resizeObserver.disconnect();
    };
  }, [videoId, topics]); // Re-run when video or topics change

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <header className="relative mb-8">
          <div className="absolute top-0 right-0">
            <LanguageToggle />
          </div>
          <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Video className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              {t('title')}
            </h1>
          </div>
          <p className="text-muted-foreground">{t('subtitle')}</p>
          </div>
        </header>

        <div className="flex flex-col items-center gap-4 mb-8">
          <UrlInput onSubmit={processVideo} isLoading={isLoading} />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('model')}:</span>
            <ModelSelector 
              value={selectedModel} 
              onChange={setSelectedModel} 
              disabled={isLoading}
            />
          </div>
        </div>

        {error && (
          <Card className="max-w-2xl mx-auto mb-6 p-4 bg-destructive/10 border-destructive/20">
            <p className="text-destructive">{error}</p>
          </Card>
        )}

        {isLoading && (
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col items-center justify-center mb-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-foreground font-medium">{t('loading.analyzing')}</p>
              <p className="text-sm text-muted-foreground mt-2">
                {loadingStage === 'fetching' && t('loading.fetching')}
                {loadingStage === 'understanding' && t('loading.understanding')}
                {loadingStage === 'generating' && t('loading.generating', { seconds: elapsedTime })}
              </p>
            </div>
            
            {/* Enhanced Loading Experience */}
            <LoadingContext 
              videoInfo={videoInfo}
              preview={videoPreview}
            />
            
            <LoadingTips />
          </div>
        )}

        {videoId && topics.length > 0 && !isLoading && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Left Column - Video (2/3 width) */}
              <div className="lg:col-span-2">
                <div className="sticky top-4" id="video-container">
                  <YouTubePlayer
                    videoId={videoId}
                    selectedTopic={selectedTopic}
                    seekToTime={seekToTime}
                    topics={topics}
                    onTopicSelect={handleTopicSelect}
                    onTimeUpdate={handleTimeUpdate}
                    transcript={transcript}
                  />
                </div>
              </div>

              {/* Right Column - Transcript (1/3 width) */}
              <div className="lg:col-span-1">
                <div 
                  className="sticky top-4" 
                  id="transcript-container"
                  style={{ height: transcriptHeight, maxHeight: transcriptHeight }}
                >
                  <TranscriptViewer
                    transcript={transcript}
                    selectedTopic={selectedTopic}
                    onTimestampClick={handleTimestampClick}
                    currentTime={currentTime}
                    topics={topics}
                    citationHighlight={citationHighlight}
                  />
                </div>
              </div>
            </div>

            {/* AI Chat Section - Full width below */}
            <div>
              <AIChat
                transcript={transcript}
                topics={topics}
                videoId={videoId}
                onTimestampClick={handleTimestampClick}
              />
            </div>
          </>
        )}

        {!isLoading && !error && topics.length === 0 && !videoId && (
          <Card className="max-w-2xl mx-auto p-12 text-center bg-muted/30">
            <Video className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground mb-2 text-lg">
              {t('empty.title')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('empty.subtitle')}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}