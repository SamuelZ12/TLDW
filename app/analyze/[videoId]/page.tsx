"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { RightColumnTabs, type RightColumnTabsHandle } from "@/components/right-column-tabs";
import { YouTubePlayer } from "@/components/youtube-player";
import { HighlightsPanel } from "@/components/highlights-panel";
import { ThemeSelector } from "@/components/theme-selector";
import { LoadingContext } from "@/components/loading-context";
import { LoadingTips } from "@/components/loading-tips";
import { VideoSkeleton } from "@/components/video-skeleton";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Topic, TranscriptSegment, VideoInfo, Citation, PlaybackCommand, Note, NoteSource, NoteMetadata, TopicCandidate, TopicGenerationMode } from "@/lib/types";
import { normalizeWhitespace } from "@/lib/quote-matcher";
import { hydrateTopicsWithTranscript, normalizeTranscript } from "@/lib/topic-utils";
import { SelectionActionPayload, EXPLAIN_SELECTION_EVENT } from "@/components/selection-actions";
import { fetchNotes, saveNote } from "@/lib/notes-client";
import { EditingNote } from "@/components/notes-panel";
import { useModePreference } from "@/lib/hooks/use-mode-preference";

// Page state for better UX
type PageState = 'IDLE' | 'ANALYZING_NEW' | 'LOADING_CACHED';
type AuthModalTrigger = 'generation-limit' | 'save-video' | 'manual' | 'save-note';
import { buildVideoSlug, extractVideoId } from "@/lib/utils";
import { NO_CREDITS_USED_MESSAGE } from "@/lib/no-credits-message";
import { useElapsedTimer } from "@/lib/hooks/use-elapsed-timer";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AuthModal } from "@/components/auth-modal";
import { TranscriptExportDialog } from "@/components/transcript-export-dialog";
import { TranscriptExportUpsell } from "@/components/transcript-export-upsell";
import { useAuth } from "@/contexts/auth-context";
import { backgroundOperation, AbortManager } from "@/lib/promise-utils";
import { toast } from "sonner";
import { createTranscriptExport, hasSpeakerMetadata, type TranscriptExportFormat } from "@/lib/transcript-export";
import { buildSuggestedQuestionFallbacks } from "@/lib/suggested-question-fallback";

const GUEST_LIMIT_MESSAGE = "You've used today's free analysis. Sign in to keep going.";
const AUTH_LIMIT_MESSAGE = "You've used all 5 free videos this month. Upgrade to Pro for 100 videos/month.";
const DEFAULT_CLIENT_ERROR = "Something went wrong. Please try again.";

type LimitCheckResponse = {
  canGenerate: boolean;
  isAuthenticated: boolean;
  tier?: 'free' | 'pro' | 'anonymous';
  reason?: string | null;
  requiresTopup?: boolean;
  requiresAuth?: boolean;
  status?: string | null;
  warning?: string | null;
  unlimited?: boolean;
  willConsumeTopup?: boolean;
  resetAt?: string | null;
  usage?: {
    totalRemaining?: number | null;
    counted?: number | null;
    cached?: number | null;
    baseLimit?: number | null;
    baseRemaining?: number | null;
    topupRemaining?: number | null;
  } | null;
};

type SubscriptionStatusState =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | null;

interface SubscriptionStatusResponse {
  tier: 'free' | 'pro';
  status: SubscriptionStatusState;
  stripeCustomerId?: string | null;
  cancelAtPeriodEnd?: boolean;
  isPastDue?: boolean;
  canPurchaseTopup?: boolean;
  nextBillingDate?: string | null;
  willConsumeTopup?: boolean;
  usage: {
    counted: number;
    cached: number;
    baseLimit: number;
    baseRemaining: number;
    topupCredits: number;
    topupRemaining: number;
    totalRemaining: number;
    resetAt: string;
  };
}

function isProSubscriptionActive(status: SubscriptionStatusResponse | null): boolean {
  if (!status) {
    return false;
  }
  if (status.tier !== 'pro') {
    return false;
  }
  return status.status === 'active' || status.status === 'trialing' || status.status === 'past_due';
}

function buildLimitExceededMessage(limitData?: LimitCheckResponse | null): string {
  if (!limitData) {
    return AUTH_LIMIT_MESSAGE;
  }

  if (limitData.reason === 'SUBSCRIPTION_INACTIVE') {
    return 'Your subscription is not active. Visit the billing portal to reactivate and continue generating videos.';
  }

  if (limitData.tier === 'pro') {
    return limitData.requiresTopup
      ? 'You have used all Pro videos this period. Purchase a Top-Up (+20 videos for $3) or wait for your next billing cycle.'
      : 'You have used your Pro allowance. Wait for your next billing cycle to reset.';
  }

  return AUTH_LIMIT_MESSAGE;
}

function normalizeErrorMessage(message: string | undefined, fallback: string = DEFAULT_CLIENT_ERROR): string {
  const trimmed = typeof message === "string" ? message.trim() : "";
  const baseMessage = trimmed.length > 0 ? trimmed : fallback;
  const normalizedSource = `${trimmed} ${baseMessage}`.toLowerCase();

  if (
    normalizedSource.includes("user aborted request") ||
    normalizedSource.includes("unsupported transcript language")
  ) {
    return "Only YouTube videos with English transcripts are supported right now. Please choose a video that has English captions enabled.";
  }

  return baseMessage;
}

function buildApiErrorMessage(errorData: unknown, fallback: string): string {
  if (!errorData || typeof errorData !== "object") {
    return normalizeErrorMessage(undefined, fallback);
  }

  const record = errorData as Record<string, unknown>;
  const errorText =
    typeof record.error === "string" && record.error.trim().length > 0
      ? record.error.trim()
      : "";
  const detailsText =
    typeof record.details === "string" && record.details.trim().length > 0
      ? record.details.trim()
      : "";

  const combinedMessage =
    errorText && detailsText
      ? `${errorText}: ${detailsText}`
      : detailsText || errorText || undefined;

  const baseMessage = normalizeErrorMessage(combinedMessage, fallback);

  const creditsMessage =
    typeof record.creditsMessage === "string" && record.creditsMessage.trim().length > 0
      ? record.creditsMessage.trim()
      : record.noCreditsUsed
        ? NO_CREDITS_USED_MESSAGE
        : "";

  if (!creditsMessage) {
    return baseMessage;
  }

  const alreadyIncludes = baseMessage.toLowerCase().includes(creditsMessage.toLowerCase());
  return alreadyIncludes ? baseMessage : `${baseMessage}\n${creditsMessage}`;
}

export default function AnalyzePage() {
  const params = useParams<{ videoId: string }>();
  const routeVideoId = Array.isArray(params?.videoId) ? params.videoId[0] : params?.videoId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlParam = searchParams?.get('url');
  const cachedParam = searchParams?.get('cached');
  const cachedParamValue = cachedParam?.toLowerCase();
  const isCachedQuery = cachedParamValue === 'true' || cachedParamValue === '1';
  const authErrorParam = searchParams?.get('auth_error');
  const slugParam = searchParams?.get('slug') ?? null;
  const [pageState, setPageState] = useState<PageState>(() =>
    (routeVideoId || urlParam)
      ? (isCachedQuery ? 'LOADING_CACHED' : 'ANALYZING_NEW')
      : 'IDLE'
  );
  const hasAttemptedLinking = useRef(false);
  const [loadingStage, setLoadingStage] = useState<'fetching' | 'understanding' | 'generating' | 'processing' | null>(null);
  const { mode, isLoading: isModeLoading } = useModePreference();
  const [error, setError] = useState("");
  const [isRateLimitError, setIsRateLimitError] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [baseTopics, setBaseTopics] = useState<Topic[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [themeTopicsMap, setThemeTopicsMap] = useState<Record<string, Topic[]>>({});
  const [themeCandidateMap, setThemeCandidateMap] = useState<Record<string, TopicCandidate[]>>({});
  const [usedTopicKeys, setUsedTopicKeys] = useState<Set<string>>(new Set());
  const [isLoadingThemeTopics, setIsLoadingThemeTopics] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Centralized playback control state
  const [playbackCommand, setPlaybackCommand] = useState<PlaybackCommand | null>(null);
  const [transcriptHeight, setTranscriptHeight] = useState<string>("auto");
  const [citationHighlight, setCitationHighlight] = useState<Citation | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const rightColumnTabsRef = useRef<RightColumnTabsHandle>(null);
  const abortManager = useRef(new AbortManager());
  const selectedThemeRef = useRef<string | null>(null);
  const seoPathRef = useRef<string | null>(null);
  const nextThemeRequestIdRef = useRef(0);
  const activeThemeRequestIdRef = useRef<number | null>(null);
  const pendingThemeRequestsRef = useRef(new Map<string, number>());

  // Play All state (lifted from YouTubePlayer)
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);

  // Memoized setters for Play All state
  const memoizedSetPlayAllIndex = useCallback((value: number | ((prev: number) => number)) => {
    setPlayAllIndex(value);
  }, []);

  const memoizedSetIsPlayingAll = useCallback((value: boolean) => {
    setIsPlayingAll(value);
  }, []);
  
  // Takeaways generation state
  const [, setTakeawaysContent] = useState<string | null>(null);
  const [, setIsGeneratingTakeaways] = useState<boolean>(false);
  const [, setTakeawaysError] = useState<string>("");
  const [showChatTab, setShowChatTab] = useState<boolean>(false);

  // Cached suggested questions
  const [cachedSuggestedQuestions, setCachedSuggestedQuestions] = useState<string[] | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const effectiveVideoId = routeVideoId || videoId;
    if (!effectiveVideoId) {
      return;
    }

    const normalizedSlugParam = slugParam?.trim() || null;
    const derivedSlug = normalizedSlugParam
      ? normalizedSlugParam
      : (videoInfo?.title ? buildVideoSlug(videoInfo.title, effectiveVideoId) : null);

    if (!derivedSlug) {
      return;
    }

    const targetPath = `/v/${derivedSlug}`;

    if (seoPathRef.current === targetPath || window.location.pathname === targetPath) {
      seoPathRef.current = targetPath;
      return;
    }

    const newUrl = `${targetPath}${window.location.search}`;
    window.history.replaceState(window.history.state, '', newUrl);
    seoPathRef.current = targetPath;
  }, [routeVideoId, videoId, videoInfo?.title, slugParam]);

  // Transcript export state
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<TranscriptExportFormat>('txt');
  const [includeTimestamps, setIncludeTimestamps] = useState(true);
  const [includeSpeakers, setIncludeSpeakers] = useState(false);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);
  const [exportDisableMessage, setExportDisableMessage] = useState<string | null>(null);
  const [isExportingTranscript, setIsExportingTranscript] = useState(false);
  const [showExportUpsell, setShowExportUpsell] = useState(false);
  const [isCheckingSubscription, setIsCheckingSubscription] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusResponse | null>(null);
  const subscriptionStatusFetchedAtRef = useRef<number | null>(null);

  const hasSpeakerData = useMemo(() => hasSpeakerMetadata(transcript), [transcript]);

  // Use custom hook for timer logic
  const elapsedTime = useElapsedTimer(generationStartTime);
  const processingElapsedTime = useElapsedTimer(processingStartTime);

  // Auth and generation limit state
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTrigger, setAuthModalTrigger] = useState<AuthModalTrigger>('generation-limit');
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    remaining: number | null;
    resetAt: Date | null;
  }>({ remaining: -1, resetAt: null });
  const [authLimitReached, setAuthLimitReached] = useState(false);
  const hasRedirectedForLimit = useRef(false);

  // Centralized playback request functions
  const requestSeek = useCallback((time: number) => {
    setPlaybackCommand({ type: 'SEEK', time });
  }, []);

  const requestPlayTopic = useCallback((topic: Topic) => {
    setPlaybackCommand({ type: 'PLAY_TOPIC', topic, autoPlay: true });
  }, []);

  const requestPlayAll = useCallback(() => {
    if (topics.length === 0) return;
    // Set Play All state first
    setIsPlayingAll(true);
    setPlayAllIndex(0);
    setPlaybackCommand({ type: 'PLAY_ALL', autoPlay: true });
  }, [topics]);

  const clearPlaybackCommand = useCallback(() => {
    setPlaybackCommand(null);
  }, []);

  // Store current video data in sessionStorage before auth
  const storeCurrentVideoForAuth = useCallback((id?: string) => {
    const targetVideoId = id ?? videoId;
    if (targetVideoId && !user) {
      try {
        sessionStorage.setItem('pendingVideoId', targetVideoId);
        console.log('Stored video for post-auth linking:', targetVideoId);
      } catch (error) {
        console.error('Failed to persist pending video ID:', error);
      }
    }
  }, [user, videoId]);

  const promptSignInForNotes = useCallback(() => {
    if (user) return;
    storeCurrentVideoForAuth();
    setAuthModalTrigger('save-note');
    setAuthModalOpen(true);
  }, [storeCurrentVideoForAuth, user, setAuthModalTrigger]);

  const redirectToAuthForLimit = useCallback(
    (message?: string, pendingVideoId?: string) => {
      if (hasRedirectedForLimit.current) {
        return;
      }

      hasRedirectedForLimit.current = true;

      const trimmedMessage = typeof message === "string" && message.trim().length > 0
        ? message.trim()
        : GUEST_LIMIT_MESSAGE;

      const targetVideoId = pendingVideoId ?? videoId ?? routeVideoId ?? null;
      if (targetVideoId) {
        storeCurrentVideoForAuth(targetVideoId);
      }

      if (trimmedMessage) {
        try {
          sessionStorage.setItem('limitRedirectMessage', trimmedMessage);
        } catch (error) {
          console.error('Failed to persist limit redirect message:', error);
        }
      }

      router.push('/?auth=limit');
    },
    [routeVideoId, router, storeCurrentVideoForAuth, videoId]
  );

  // Check for pending video linking after auth
  const checkPendingVideoLink = async (retryCount = 0) => {
    // Check both sessionStorage and current videoId state
    const pendingVideoId = sessionStorage.getItem('pendingVideoId');
    const currentVideoId = videoId;
    const videoToLink = pendingVideoId || currentVideoId;

    console.log('Checking for video to link:', {
      pendingVideoId,
      currentVideoId,
      user: user?.email,
      retryCount
    });

    if (videoToLink && user) {
      console.log('Found video to link:', videoToLink);

      // First, check if the video exists in the database
      try {
        // Construct YouTube URL from videoId for the cache check
        const checkUrl = `https://www.youtube.com/watch?v=${videoToLink}`;
        const checkResponse = await fetch('/api/check-video-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: checkUrl })
        });

        if (!checkResponse.ok || !(await checkResponse.json()).cached) {
          // Video doesn't exist yet, don't try to link
          console.log('Video not yet in database, skipping link');
          return;
        }
      } catch (error) {
        console.error('Error checking video cache:', error);
        return;
      }

      try {
        const response = await fetch('/api/link-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: videoToLink })
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Link video response:', data);
          // Only show toast for newly linked videos, not already linked ones
          if (!data.alreadyLinked) {
            toast.success('Video saved to your library!');
          }
          sessionStorage.removeItem('pendingVideoId');
        } else if (response.status === 404 && retryCount < 3) {
          // Retry with exponential backoff if video not found
          console.log(`Video not found, retrying in ${1000 * (retryCount + 1)}ms...`);
          setTimeout(() => {
            checkPendingVideoLink(retryCount + 1);
          }, 1000 * (retryCount + 1));
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error('Failed to link video:', errorData);
          // Don't remove pendingVideoId on error, so it can be retried later
        }
      } catch (error) {
        console.error('Error linking video:', error);
      }
    }
  };

  const checkRateLimit = useCallback(async (): Promise<LimitCheckResponse | null> => {
    try {
      const response = await fetch('/api/check-limit');
      const data: LimitCheckResponse = await response.json();

      setAuthLimitReached(Boolean(data?.isAuthenticated && data?.canGenerate === false && data?.reason === 'LIMIT_REACHED'));

      const usage = data?.usage;
      const remainingValue =
        typeof usage?.totalRemaining === 'number'
          ? usage.totalRemaining
          : usage?.totalRemaining === null
            ? null
            : -1;

      const resetTimestamp = data?.resetAt ?? null;

      setRateLimitInfo({
        remaining: remainingValue,
        resetAt: resetTimestamp ? new Date(resetTimestamp) : null,
      });

      return data;
    } catch (error) {
      console.error('Error checking rate limit:', error);
      setAuthLimitReached(false);
      return null;
    }
  }, []);

  const fetchSubscriptionStatus = useCallback(
    async (options?: { force?: boolean }): Promise<SubscriptionStatusResponse | null> => {
      if (!user) {
        return null;
      }

      const lastFetchedAt = subscriptionStatusFetchedAtRef.current;
      if (
        !options?.force &&
        subscriptionStatus &&
        lastFetchedAt &&
        Date.now() - lastFetchedAt < 60_000
      ) {
        return subscriptionStatus;
      }

      setIsCheckingSubscription(true);
      try {
        const response = await fetch('/api/subscription/status', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });

        if (response.status === 401) {
          storeCurrentVideoForAuth();
          setAuthModalTrigger('manual');
          setAuthModalOpen(true);
          return null;
        }

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          const message =
            typeof (errorPayload as { error?: string }).error === 'string'
              ? (errorPayload as { error?: string }).error!
              : 'Failed to check subscription status. Please try again.';
          toast.error(message);
          return null;
        }

        const data: SubscriptionStatusResponse = await response.json();
        setSubscriptionStatus(data);
        subscriptionStatusFetchedAtRef.current = Date.now();
        return data;
      } catch (error) {
        console.error('Failed to fetch subscription status:', error);
        toast.error('Unable to check your subscription right now.');
        return null;
      } finally {
        setIsCheckingSubscription(false);
      }
    },
    [user, subscriptionStatus, storeCurrentVideoForAuth, setAuthModalTrigger, setAuthModalOpen]
  );

  // Check rate limit status on mount
  useEffect(() => {
    checkRateLimit();
  }, [checkRateLimit]);

  useEffect(() => {
    subscriptionStatusFetchedAtRef.current = null;
    setSubscriptionStatus(null);
  }, [user]);

  useEffect(() => {
    if (exportFormat === 'srt' && !includeTimestamps) {
      setIncludeTimestamps(true);
    }
  }, [exportFormat, includeTimestamps]);

  useEffect(() => {
    if (!hasSpeakerData && includeSpeakers) {
      setIncludeSpeakers(false);
    }
  }, [hasSpeakerData, includeSpeakers]);

  // Handle pending video linking when user logs in and videoId is available
  useEffect(() => {
    if (user && !hasAttemptedLinking.current && (videoId || sessionStorage.getItem('pendingVideoId'))) {
      hasAttemptedLinking.current = true;
      // Delay the link attempt to ensure authentication is fully propagated
      setTimeout(() => {
        checkPendingVideoLink();
      }, 1500);
    }
  }, [user, videoId]); // Properly track both dependencies

  // Cleanup AbortManager on component unmount
  useEffect(() => {
    const currentAbortManager = abortManager.current;
    return () => {
      // Abort all pending requests when component unmounts
      currentAbortManager.cleanup();
    };
  }, []);

  const lastInitializedKey = useRef<string | null>(null);
  const normalizedUrl = urlParam ?? (routeVideoId ? `https://www.youtube.com/watch?v=${routeVideoId}` : "");

  // Clear auth errors from URL after notifying the user
  useEffect(() => {
    if (!authErrorParam || !routeVideoId) return;

    toast.error(`Authentication failed: ${decodeURIComponent(authErrorParam)}`);

    const params = new URLSearchParams(searchParams.toString());
    params.delete('auth_error');

    const queryString = params.toString();
    router.replace(
      `/analyze/${routeVideoId}${queryString ? `?${queryString}` : ''}`,
      { scroll: false }
    );
  }, [authErrorParam, router, routeVideoId, searchParams]);

  // Automatically kick off analysis when arriving via dedicated route
  // Check if user can generate based on server-side rate limits
  const checkGenerationLimit = useCallback((
    pendingVideoId?: string,
    remainingOverride?: number | null,
    latestLimitData?: LimitCheckResponse | null
  ): boolean => {
    if (user) {
      const limitReached =
        latestLimitData?.isAuthenticated
          ? latestLimitData.canGenerate === false
          : authLimitReached;

      if (limitReached) {
        const limitMessage = buildLimitExceededMessage(latestLimitData);
        setIsRateLimitError(true);
        setError(limitMessage);
        toast.error(limitMessage);
        return false;
      }
      return true;
    }

    let effectiveRemaining =
      typeof remainingOverride === 'number' || remainingOverride === null
        ? remainingOverride
        : rateLimitInfo.remaining;

    if (!latestLimitData?.isAuthenticated) {
      const totalRemaining = latestLimitData?.usage?.totalRemaining;
      if (typeof totalRemaining === 'number' || totalRemaining === null) {
        effectiveRemaining = totalRemaining;
      }
    }

    if (
      typeof effectiveRemaining === 'number' &&
      effectiveRemaining !== -1 &&
      effectiveRemaining <= 0
    ) {
      redirectToAuthForLimit(undefined, pendingVideoId);
      return false;
    }
    return true;
  }, [user, authLimitReached, rateLimitInfo.remaining, redirectToAuthForLimit]);

  const processVideo = useCallback(async (
    url: string,
    selectedMode: TopicGenerationMode
  ) => {
    const currentRemaining = rateLimitInfo.remaining;
    try {
      const extractedVideoId = extractVideoId(url);
      if (!extractedVideoId) {
        throw new Error("Invalid YouTube URL");
      }

      // Cleanup any pending requests from previous analysis
      abortManager.current.cleanup();
      pendingThemeRequestsRef.current.clear();
      activeThemeRequestIdRef.current = null;
      nextThemeRequestIdRef.current = 0;
      selectedThemeRef.current = null;

      setError("");
      setIsRateLimitError(false);
      setTopics([]);
      setBaseTopics([]);
      setTranscript([]);
      setThemes([]);
      setSelectedTheme(null);
      setThemeTopicsMap({});
      setThemeCandidateMap({});
      setUsedTopicKeys(new Set());
      setThemeError(null);
      setIsLoadingThemeTopics(false);
      setSelectedTopic(null);
      setCurrentTime(0);
      setVideoDuration(0);
      setCitationHighlight(null);
      setVideoInfo(null);
      setVideoPreview("");
      setPlaybackCommand(null);
      setIsPlayingAll(false);
      setPlayAllIndex(0);

      // Reset takeaways-related states
      setTakeawaysContent(null);
      setTakeawaysError("");
      setShowChatTab(false);

      // Reset cached suggested questions
      setCachedSuggestedQuestions(null);

      // Store video ID immediately for potential post-auth linking
      storeCurrentVideoForAuth(extractedVideoId);

      // Only set videoId if it's different to prevent unnecessary re-renders
      if (videoId !== extractedVideoId) {
        setVideoId(extractedVideoId);
      }

      // Check cache first before fetching transcript/metadata
      const cacheResponse = await fetch("/api/check-video-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (cacheResponse.ok) {
        const cacheData = await cacheResponse.json();

        if (cacheData.cached) {
          // For cached videos, we're already in LOADING_CACHED state if isCached was true
          // Otherwise, set it now
          setPageState('LOADING_CACHED');

          const sanitizedTranscript = normalizeTranscript(cacheData.transcript);
          const hydratedTopics = hydrateTopicsWithTranscript(
            Array.isArray(cacheData.topics) ? cacheData.topics : [],
            sanitizedTranscript,
          );

          // Load all cached data
          setTranscript(sanitizedTranscript);

          const cachedVideoInfo = cacheData.videoInfo ?? null;
          if (cachedVideoInfo) {
            setVideoInfo(cachedVideoInfo);
            const rawDuration = (cachedVideoInfo as { duration?: number | string | null }).duration;
            const numericDuration =
              typeof rawDuration === "number"
                ? rawDuration
                : typeof rawDuration === "string"
                  ? Number(rawDuration)
                  : null;
            if (numericDuration && !Number.isNaN(numericDuration) && numericDuration > 0) {
              setVideoDuration(numericDuration);
            }
          } else {
            setVideoInfo(null);
          }

          setTopics(hydratedTopics);
          setBaseTopics(hydratedTopics);
          const initialKeys = new Set<string>();
          hydratedTopics.forEach(topic => {
            if (topic.quote?.timestamp && topic.quote.text) {
              const key = `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`;
              initialKeys.add(key);
            }
          });
          setUsedTopicKeys(initialKeys);
          setSelectedTopic(hydratedTopics.length > 0 ? hydratedTopics[0] : null);

          // Set cached takeaways and questions
          if (cacheData.summary) {
            setTakeawaysContent(cacheData.summary);
            setShowChatTab(true);
            setIsGeneratingTakeaways(false);
          }
          if (cacheData.suggestedQuestions) {
            setCachedSuggestedQuestions(cacheData.suggestedQuestions);
          }

          // Store video ID for potential post-auth linking (for cached videos)
          storeCurrentVideoForAuth(extractedVideoId);

          // Set page state back to idle
          setPageState('IDLE');
          setLoadingStage(null);
          setProcessingStartTime(null);

          // Show contextual notification for cached analysis
          if (user && !cacheData.ownedByCurrentUser) {
            toast.success("Lucky you — Someone's already analyzed this video! No credits used.");
          }

          backgroundOperation(
            'load-cached-themes',
            async () => {
              const response = await fetch("/api/video-analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  videoId: extractedVideoId,
                  videoInfo: cacheData.videoInfo,
                  transcript: sanitizedTranscript,
                  model: 'gemini-2.5-flash',
                  includeCandidatePool: true,
                  mode: selectedMode
                }),
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
                const message = buildApiErrorMessage(errorData, "Failed to generate themes");
                throw new Error(message);
              }

              const data = await response.json();
              if (Array.isArray(data.themes)) {
                setThemes(data.themes);
              }
              if (Array.isArray(data.topicCandidates)) {
                setThemeCandidateMap(prev => ({
                  ...prev,
                  __default: data.topicCandidates
                }));
              }
              return data.themes;
            },
            (error) => {
              console.error("Failed to generate themes for cached video:", error);
            }
          );

          // Auto-start takeaways generation if not available
          if (!cacheData.summary) {
            setShowChatTab(true);
            setIsGeneratingTakeaways(true);

            backgroundOperation(
              'generate-cached-takeaways',
              async () => {
                const summaryRes = await fetch("/api/generate-summary", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    transcript: sanitizedTranscript,
                    videoInfo: cacheData.videoInfo,
                    videoId: extractedVideoId
                  }),
                });

                if (summaryRes.ok) {
                  const { summaryContent: generatedTakeaways } = await summaryRes.json();
                  setTakeawaysContent(generatedTakeaways);

                  // Update the video analysis with the takeaways
                  await backgroundOperation(
                    'update-cached-takeaways',
                    async () => {
                      await fetch("/api/update-video-analysis", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          videoId: extractedVideoId,
                          summary: generatedTakeaways
                        }),
                      });
                    }
                  );
                  return generatedTakeaways;
                } else {
                  const errorData = await summaryRes.json().catch(() => ({ error: "Unknown error" }));
                  const message = buildApiErrorMessage(errorData, "Failed to generate takeaways");
                  throw new Error(message);
                }
              },
              (error) => {
                setTakeawaysError(error.message || "Failed to generate takeaways. Please try again.");
              }
            ).finally(() => {
              setIsGeneratingTakeaways(false);
            });
          }

          return; // Exit early - no need to fetch anything else
        }
      }

      let effectiveRemaining = currentRemaining;
      const latestLimitData = await checkRateLimit();

      if (!user && latestLimitData) {
        const totalRemaining = latestLimitData.usage?.totalRemaining;
        if (typeof totalRemaining === 'number' || totalRemaining === null) {
          effectiveRemaining = totalRemaining;
        }
      }

      if (!checkGenerationLimit(extractedVideoId, effectiveRemaining, latestLimitData)) {
        return;
      }

      setPageState('ANALYZING_NEW');
      setLoadingStage('fetching');

      // Not cached, proceed with normal flow
      // Create AbortControllers for both requests
      const transcriptController = abortManager.current.createController('transcript', 300000);
      const videoInfoController = abortManager.current.createController('videoInfo', 100000);

      // Fetch transcript and video info in parallel
      const transcriptPromise = fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: transcriptController.signal,
      }).catch(err => {
        if (err.name === 'AbortError') {
          throw new Error("Transcript request timed out. Please try again.");
        }
        throw new Error("Network error: Unable to fetch transcript. Please ensure the server is running.");
      });

      const videoInfoPromise = fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: videoInfoController.signal,
      }).catch(err => {
        if (err.name === 'AbortError') {
          console.error("Video info request timed out");
          return null;
        }
        console.error("Failed to fetch video info:", err);
        return null;
      });

      // Wait for both requests to complete
      const [transcriptRes, videoInfoRes] = await Promise.all([
        transcriptPromise,
        videoInfoPromise
      ]);

      // AbortManager handles timeout cleanup automatically

      // Process transcript response (required)
      if (!transcriptRes || !transcriptRes.ok) {
        const errorData = transcriptRes ? await transcriptRes.json().catch(() => ({ error: "Unknown error" })) : { error: "Failed to fetch transcript" };
        const message = buildApiErrorMessage(errorData, "Failed to fetch transcript");
        throw new Error(message);
      }

      let fetchedTranscript;
      try {
        const data = await transcriptRes.json();
        fetchedTranscript = data.transcript;
      } catch (jsonError) {
        if (jsonError instanceof Error && jsonError.name === 'AbortError') {
          throw new Error("Transcript processing timed out. The video may be too long. Please try again.");
        }
        throw new Error("Failed to process transcript data. Please try again.");
      }

      const normalizedTranscriptData = normalizeTranscript(fetchedTranscript);
      setTranscript(normalizedTranscriptData);

      // Process video info response (optional)
      let fetchedVideoInfo: VideoInfo | null = null;
      if (videoInfoRes && videoInfoRes.ok) {
        try {
          const videoInfoData = await videoInfoRes.json();
          if (videoInfoData && !videoInfoData.error) {
            setVideoInfo(videoInfoData);
            const rawDuration = videoInfoData?.duration;
            const numericDuration =
              typeof rawDuration === "number"
                ? rawDuration
                : typeof rawDuration === "string"
                  ? Number(rawDuration)
                  : null;
            if (numericDuration && !Number.isNaN(numericDuration) && numericDuration > 0) {
              setVideoDuration(numericDuration);
            }
            fetchedVideoInfo = videoInfoData;
          }
        } catch (error) {
          console.error("Failed to parse video info:", error);
        }
      }

      // Move to understanding stage
      setLoadingStage('understanding');
      
      // Generate quick preview (non-blocking)
      fetch("/api/quick-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: normalizedTranscriptData,
          videoTitle: fetchedVideoInfo?.title,
          videoDescription: fetchedVideoInfo?.description,
          channelName: fetchedVideoInfo?.author,
          tags: fetchedVideoInfo?.tags
        }),
      })
        .then(res => {
          if (!res.ok) {
            console.error('Quick preview generation failed:', res.status);
            return null;
          }
          return res.json();
        })
        .then(data => {
          if (data && data.preview) {
            console.log('Quick preview generated:', data.preview);
            setVideoPreview(data.preview);
          }
        })
        .catch((error) => {
          console.error('Error generating quick preview:', error);
        });
      
      // Initiate parallel API requests for topics and takeaways
      setLoadingStage('generating');
      setGenerationStartTime(Date.now());

      // Create abort controllers for both requests
      const topicsController = abortManager.current.createController('topics');
      const takeawaysController = abortManager.current.createController('takeaways', 60000);

      // Start topics generation using cached video-analysis endpoint
      const topicsPromise = fetch("/api/video-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: extractedVideoId,
          videoInfo: fetchedVideoInfo,
          transcript: normalizedTranscriptData,
          model: 'gemini-2.5-flash',
          mode: selectedMode
        }),
        signal: topicsController.signal,
      }).catch(err => {
        if (err.name === 'AbortError') {
          throw new Error("Topic generation was canceled or interrupted. Please try again.");
        }
        throw new Error("Network error: Unable to generate topics. Please check your connection.");
      });

      // Start takeaways generation in parallel (will be ignored if cached)
      const takeawaysPromise = fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: normalizedTranscriptData,
          videoInfo: fetchedVideoInfo,
          videoId: extractedVideoId
        }),
        signal: takeawaysController.signal,
      });

      // Show takeaways tab and loading state immediately (optimistic UI)
      setShowChatTab(true);
      setIsGeneratingTakeaways(true);

      // Wait for both to complete using Promise.allSettled
      const [topicsResult, takeawaysResult] = await Promise.allSettled([
        topicsPromise,
        takeawaysPromise
      ]);

      // Move to processing stage
      setLoadingStage('processing');
      setGenerationStartTime(null);
      setProcessingStartTime(Date.now());

      // Process topics result
      let generatedTopics: Topic[] = [];
      let generatedThemes: string[] = [];
      let generatedCandidates: TopicCandidate[] = [];
      if (topicsResult.status === 'fulfilled') {
        const topicsRes = topicsResult.value;

        if (!topicsRes.ok) {
          const errorData = await topicsRes.json().catch(() => ({ error: "Unknown error" }));
          const requiresAuth = Boolean((errorData as any)?.requiresAuth);

          if (topicsRes.status === 429 && requiresAuth) {
            redirectToAuthForLimit(
              typeof (errorData as any)?.message === "string" ? (errorData as any).message : undefined,
              extractedVideoId
            );
            return;
          }

          if (topicsRes.status === 429) {
            setIsRateLimitError(true);
            checkRateLimit();

            const limitMessageRaw =
              typeof (errorData as any)?.message === "string"
                ? (errorData as any).message.trim()
                : "";

            const limitErrorRaw =
              typeof (errorData as any)?.error === "string"
                ? (errorData as any).error.trim()
                : "";

            const limitMessage =
              limitMessageRaw.length > 0
                ? limitMessageRaw
                : limitErrorRaw.length > 0
                  ? limitErrorRaw
                  : AUTH_LIMIT_MESSAGE;

            throw new Error(limitMessage);
          }

          const message = buildApiErrorMessage(errorData, "Failed to generate topics");
          throw new Error(message);
        }

        const topicsData = await topicsRes.json();
        const rawTopics = Array.isArray(topicsData.topics) ? topicsData.topics : [];
        generatedTopics = hydrateTopicsWithTranscript(rawTopics, normalizedTranscriptData);
        generatedThemes = Array.isArray(topicsData.themes) ? topicsData.themes : [];
        generatedCandidates = Array.isArray(topicsData.topicCandidates) ? topicsData.topicCandidates : [];
        generatedCandidates = generatedCandidates.map(candidate => ({
          ...candidate,
          key: `${candidate.quote.timestamp}|${normalizeWhitespace(candidate.quote.text)}`
        }));
      } else {
        throw topicsResult.reason;
      }

      // Process takeaways result from parallel execution
      let generatedTakeaways = null;
      let takeawaysGenerationError = null;
      if (takeawaysResult.status === 'fulfilled') {
        const summaryRes = takeawaysResult.value;

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          generatedTakeaways = summaryData.summaryContent;
        } else {
          const errorData = await summaryRes.json().catch(() => ({ error: "Unknown error" }));
          takeawaysGenerationError = buildApiErrorMessage(errorData, "Failed to generate takeaways. Please try again.");
        }
      } else {
        const error = takeawaysResult.reason;
        if (error && error.name === 'AbortError') {
          takeawaysGenerationError = "Takeaways generation timed out. The video might be too long.";
        } else {
          takeawaysGenerationError = error?.message || "Failed to generate takeaways. Please try again.";
        }
      }

      // Synchronous batch state update - all at once
      setTopics(generatedTopics);
      setBaseTopics(generatedTopics);
      const initialKeys = new Set<string>();
      generatedTopics.forEach(topic => {
        if (topic.quote?.timestamp && topic.quote.text) {
          initialKeys.add(`${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`);
        }
      });
      setUsedTopicKeys(initialKeys);
      setThemeCandidateMap(prev => ({
        ...prev,
        __default: generatedCandidates
      }));
      setSelectedTopic(generatedTopics.length > 0 ? generatedTopics[0] : null);
      setThemes(generatedThemes);
      if (generatedTakeaways) {
        setTakeawaysContent(generatedTakeaways);
        setShowChatTab(true);
        setIsGeneratingTakeaways(false);
      } else if (takeawaysGenerationError) {
        setTakeawaysError(takeawaysGenerationError);
        setShowChatTab(true);
        setIsGeneratingTakeaways(false);
      }

      // Rate limit is handled server-side now
      checkRateLimit();

      // Save complete analysis to database in background
      backgroundOperation(
        'save-complete-analysis',
        async () => {
          const response = await fetch("/api/save-analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              videoId: extractedVideoId,
              videoInfo: fetchedVideoInfo || {
                title: `YouTube Video ${extractedVideoId}`,
                author: 'Unknown',
                duration: 0,
                thumbnail: ''
              },
              transcript: normalizedTranscriptData,
              topics: generatedTopics,
              summary: generatedTakeaways,
              model: 'gemini-2.5-flash'
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
            const message = buildApiErrorMessage(errorData, "Failed to save analysis");
            throw new Error(message);
          }
        },
        (error) => {
          console.error('Failed to save analysis to database:', error);
          toast.error('Unable to save video analysis. Your results are still visible.');
        }
      );

      // Generate suggested questions
      backgroundOperation(
        'generate-questions',
        async () => {
          const res = await fetch("/api/suggested-questions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: normalizedTranscriptData,
              topics: generatedTopics,
              videoTitle: fetchedVideoInfo?.title
            }),
          });

          const applyCachedQuestions = (questions: string[]) => {
            if (questions.length === 0) {
              return questions;
            }
            setCachedSuggestedQuestions(prev => {
              if (prev && prev.length > 0) {
                return prev;
              }
              return questions;
            });
            return questions;
          };

          if (!res.ok) {
            console.error("Failed to generate suggested questions:", res.status, res.statusText);
            return applyCachedQuestions(buildSuggestedQuestionFallbacks(3));
          }

          let parsed: unknown;
          try {
            parsed = await res.json();
          } catch (error) {
            console.error("Failed to parse suggested questions payload:", error);
            return applyCachedQuestions(buildSuggestedQuestionFallbacks(3));
          }

          const questions = Array.isArray((parsed as any)?.questions)
            ? (parsed as any).questions
                .filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
                .map((item: string) => item.trim())
            : [];

          const normalizedQuestions = questions.length > 0
            ? questions.slice(0, 3)
            : buildSuggestedQuestionFallbacks(3);

          applyCachedQuestions(normalizedQuestions);

          // Update video analysis with suggested questions
          await backgroundOperation(
            'update-questions',
            async () => {
              const updateRes = await fetch("/api/update-video-analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  videoId: extractedVideoId,
                  suggestedQuestions: normalizedQuestions
                }),
              });

              if (!updateRes.ok && updateRes.status !== 404) {
                throw new Error('Failed to update suggested questions');
              }
            }
          );

          return normalizedQuestions;
        },
        (error) => {
          console.error("Failed to generate suggested questions:", error);
        }
      );
      
    } catch (err) {
      setError(
        normalizeErrorMessage(
          err instanceof Error ? err.message : undefined,
          "An error occurred"
        )
      );
    } finally {
      setPageState('IDLE');
      setLoadingStage(null);
      setGenerationStartTime(null);
      setProcessingStartTime(null);
    }
  }, [
    rateLimitInfo.remaining,
    storeCurrentVideoForAuth,
    videoId,
    checkRateLimit,
    user,
    checkGenerationLimit,
    redirectToAuthForLimit
  ]);

  useEffect(() => {
    if (!routeVideoId || isModeLoading) return;

    const key = `${routeVideoId}|${urlParam ?? ''}|${cachedParam ?? ''}|${mode}`;
    if (lastInitializedKey.current === key) return;

    lastInitializedKey.current = key;

    // Store video ID for potential post-auth linking before loading
    if (!user) {
      sessionStorage.setItem('pendingVideoId', routeVideoId);
      console.log('Stored route video ID for potential post-auth linking:', routeVideoId);
    }

    processVideo(normalizedUrl, mode);
  }, [routeVideoId, urlParam, cachedParam, user, normalizedUrl, isModeLoading, mode, processVideo]);

  const handleCitationClick = (citation: Citation) => {
    // Reset Play All mode when clicking a citation
    setIsPlayingAll(false);
    setPlayAllIndex(0);
    
    setSelectedTopic(null);
    setCitationHighlight(citation);

    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      videoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Request seek through centralized command system
    requestSeek(citation.start);
  };

  const handleTimestampClick = (seconds: number, _endSeconds?: number, isCitation: boolean = false, _citationText?: string, isWithinHighlightReel: boolean = false, isWithinCitationHighlight: boolean = false) => {
    // Reset Play All mode when clicking any timestamp
    setIsPlayingAll(false);
    setPlayAllIndex(0);

    // Handle topic selection clearing:
    // Clear topic if it's a new citation click from AI chat OR
    // if clicking outside the current highlight reel (and not within a citation)
    if (isCitation || (!isWithinHighlightReel && !isWithinCitationHighlight)) {
      setSelectedTopic(null);
    }

    // Clear citation highlight for non-citation clicks
    if (!isCitation) {
      setCitationHighlight(null);
    }

    // Scroll to video player
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      videoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Request seek through centralized command system
    requestSeek(seconds);
  };

  const handleTimeUpdate = useCallback((seconds: number) => {
    setCurrentTime(seconds);
  }, []);

  const handleTopicSelect = useCallback((topic: Topic | null, fromPlayAll: boolean = false) => {
    // Reset Play All mode only when manually selecting a topic (not from Play All)
    if (!fromPlayAll && isPlayingAll) {
      setIsPlayingAll(false);
      setPlayAllIndex(0);
    }

    // Clear citation highlight when selecting a topic
    setCitationHighlight(null);
    setSelectedTopic(topic);

    // Request to play the topic through centralized command system
    if (topic && !fromPlayAll) {
      requestPlayTopic(topic);
    }
  }, [isPlayingAll, requestPlayTopic]);

  const handleTogglePlayAll = useCallback(() => {
    if (isPlayingAll) {
      // Stop playing all
      setIsPlayingAll(false);
      setPlayAllIndex(0);
      setPlaybackCommand({ type: 'PAUSE' });
    } else {
      // Clear any existing selection to start fresh
      setSelectedTopic(null);
      // Request to play all topics through centralized command system
      requestPlayAll();
    }
  }, [isPlayingAll, requestPlayAll]);

  useEffect(() => {
    selectedThemeRef.current = selectedTheme;
  }, [selectedTheme]);

  const handleThemeSelect = useCallback(async (themeLabel: string | null) => {
    if (!videoId) return;

    const resetToDefault = (options?: { preserveError?: boolean }) => {
      if (!options?.preserveError) {
        setThemeError(null);
      }
      setSelectedTheme(null);
      selectedThemeRef.current = null;
      setTopics(baseTopics);
      setSelectedTopic(null);
      setIsPlayingAll(false);
      setPlayAllIndex(0);
      setIsLoadingThemeTopics(false);
      activeThemeRequestIdRef.current = null;
      setUsedTopicKeys(new Set(
        baseTopics
          .filter((topic): topic is Topic & { quote: { timestamp: string; text: string } } => !!topic.quote?.timestamp && !!topic.quote.text)
          .map(topic => `${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`)
      ));
    };

    if (!themeLabel) {
      resetToDefault();
      return;
    }

    const normalizedTheme = themeLabel.trim();

    if (!normalizedTheme) {
      resetToDefault();
      return;
    }

    if (selectedTheme === normalizedTheme) {
      resetToDefault();
      return;
    }

    let themedTopics = themeTopicsMap[normalizedTheme];
    const needsHydration =
      Array.isArray(themedTopics) &&
      themedTopics.some((topic) => {
        const firstSegment = Array.isArray(topic?.segments) ? topic.segments[0] : null;
        return !firstSegment || typeof firstSegment.start !== 'number' || typeof firstSegment.end !== 'number';
      });

    if (themedTopics && needsHydration) {
      themedTopics = hydrateTopicsWithTranscript(themedTopics, transcript);
      setThemeTopicsMap(prev => ({
        ...prev,
        [normalizedTheme]: themedTopics || [],
      }));
    }

    setSelectedTheme(normalizedTheme);
    selectedThemeRef.current = normalizedTheme;
    setThemeError(null);
    setSelectedTopic(null);
    setIsPlayingAll(false);
    setPlayAllIndex(0);

    const pendingRequestId = pendingThemeRequestsRef.current.get(normalizedTheme);

    if (!themedTopics && typeof pendingRequestId === "number") {
      activeThemeRequestIdRef.current = pendingRequestId;
      setIsLoadingThemeTopics(true);
      return;
    }

    if (!themedTopics) {
      const requestId = ++nextThemeRequestIdRef.current;
      pendingThemeRequestsRef.current.set(normalizedTheme, requestId);
      activeThemeRequestIdRef.current = requestId;
      setIsLoadingThemeTopics(true);
      const requestKey = `theme-topics:${normalizedTheme}:${requestId}`;
      const controller = abortManager.current.createController(requestKey);
      const exclusionKeys = Array.from(usedTopicKeys).map((key) => key.slice(0, 500));

      try {
        const response = await fetch("/api/video-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId,
            videoInfo,
            transcript,
            model: 'gemini-2.5-flash',
            theme: normalizedTheme,
            excludeTopicKeys: exclusionKeys,
            mode
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
          const message = buildApiErrorMessage(errorData, "Failed to generate themed topics");
          throw new Error(message);
        }

        const data = await response.json();
        const hydratedThemeTopics = hydrateTopicsWithTranscript(Array.isArray(data.topics) ? data.topics : [], transcript);
        const candidatePool = Array.isArray(data.topicCandidates) ? data.topicCandidates : undefined;
        setThemeCandidateMap(prev => ({
          ...prev,
          [normalizedTheme]: candidatePool ?? []
        }));
        const nextUsedKeys = new Set(usedTopicKeys);
        hydratedThemeTopics.forEach(topic => {
          if (topic.quote?.timestamp && topic.quote.text) {
            nextUsedKeys.add(`${topic.quote.timestamp}|${normalizeWhitespace(topic.quote.text)}`);
          }
        });
        setUsedTopicKeys(nextUsedKeys);
        themedTopics = hydratedThemeTopics;
        setThemeTopicsMap(prev => ({
          ...prev,
          [normalizedTheme]: themedTopics || []
        }));
      } catch (error) {
        const isAbortError =
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error as { name?: string }).name === "AbortError";

        if (isAbortError) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to generate themed topics";
        console.error("Theme-specific generation failed:", error);
        if (selectedThemeRef.current === normalizedTheme) {
          resetToDefault({ preserveError: true });
          setThemeError(message);
        }
        return;
      } finally {
        abortManager.current.cleanup(requestKey);
        pendingThemeRequestsRef.current.delete(normalizedTheme);
        if (
          activeThemeRequestIdRef.current === requestId &&
          selectedThemeRef.current === normalizedTheme
        ) {
          setIsLoadingThemeTopics(false);
          activeThemeRequestIdRef.current = null;
        }
      }
    } else {
      activeThemeRequestIdRef.current = null;
      setIsLoadingThemeTopics(false);
    }

    if (!themedTopics) {
      themedTopics = [];
    }

    if (themedTopics.length === 0) {
      setThemeCandidateMap(prev => ({
        ...prev,
        [normalizedTheme]: prev[normalizedTheme] ?? []
      }));
    }

    if (selectedThemeRef.current !== normalizedTheme) {
      return;
    }

    setTopics(themedTopics);
    if (themedTopics.length > 0) {
      setSelectedTopic(themedTopics[0]);
      setThemeError(null);
    } else {
      setThemeError("No highlights available for this theme yet.");
      setSelectedTopic(null);
    }
  }, [
    videoId,
    videoInfo,
    transcript,
    selectedTheme,
    baseTopics,
    themeTopicsMap,
    usedTopicKeys,
    mode,
    setIsPlayingAll,
    setPlayAllIndex
  ]);

  // Dynamically adjust right column height to match video container
  useEffect(() => {
    const adjustRightColumnHeight = () => {
      const videoContainer = document.getElementById("video-container");
      const rightColumnContainer = document.getElementById("right-column-container");
      
      if (videoContainer && rightColumnContainer) {
        const videoHeight = videoContainer.offsetHeight;
        setTranscriptHeight(`${videoHeight}px`);
      }
    };

    // Initial adjustment
    adjustRightColumnHeight();

    // Adjust on window resize
    window.addEventListener("resize", adjustRightColumnHeight);
    
    // Also observe video container for size changes
    const resizeObserver = new ResizeObserver(adjustRightColumnHeight);
    const videoContainer = document.getElementById("video-container");
    if (videoContainer) {
      resizeObserver.observe(videoContainer);
    }

    return () => {
      window.removeEventListener("resize", adjustRightColumnHeight);
      resizeObserver.disconnect();
    };
  }, [videoId, topics]); // Re-run when video or topics change

  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [editingNote, setEditingNote] = useState<EditingNote | null>(null);

  useEffect(() => {
    if (!videoId || !user) {
      setNotes([]);
      return;
    }

    setIsLoadingNotes(true);
    fetchNotes({ youtubeId: videoId })
      .then(setNotes)
      .catch((error) => {
        console.error("Failed to load notes", error);
      })
      .finally(() => setIsLoadingNotes(false));
  }, [videoId, user]);

  // Auto-switch to Chat tab when Explain is triggered from transcript
  useEffect(() => {
    const handleExplainFromSelection = () => {
      // Switch to chat tab when explain is triggered
      rightColumnTabsRef.current?.switchToChat?.();
    };

    window.addEventListener(EXPLAIN_SELECTION_EVENT, handleExplainFromSelection as EventListener);
    return () => {
      window.removeEventListener(EXPLAIN_SELECTION_EVENT, handleExplainFromSelection as EventListener);
    };
  }, []);

  const handleSaveNote = useCallback(async ({ text, source, sourceId, metadata }: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => {
    if (!videoId) return;
    if (!user) {
      promptSignInForNotes();
      return;
    }

    try {
      const note = await saveNote({
        youtubeId: videoId,
        source,
        sourceId: sourceId ?? undefined,
        text,
        metadata: metadata ?? undefined,
      });
      setNotes((prev) => [note, ...prev]);
      toast.success("Note saved");
    } catch (error) {
      console.error("Failed to save note", error);
      toast.error("Failed to save note");
    }
  }, [videoId, user, promptSignInForNotes]);

  const handleTakeNoteFromSelection = useCallback((payload: SelectionActionPayload) => {
    if (!user) {
      promptSignInForNotes();
      return;
    }

    // Switch to notes tab
    rightColumnTabsRef.current?.switchToNotes();

    // Set editing state with selected text, metadata, and source
    setEditingNote({
      text: payload.text,
      metadata: payload.metadata ?? null,
      source: payload.source,
    });
  }, [promptSignInForNotes, user]);

  const handleSaveEditingNote = useCallback(async ({ noteText, selectedText }: { noteText: string; selectedText: string }) => {
    if (!editingNote || !videoId) return;

    // Use source from editing note or determine from metadata
    let source: NoteSource = "custom";
    if (editingNote.source) {
      source = editingNote.source as NoteSource;
    } else if (editingNote.metadata?.chat) {
      source = "chat";
    } else if (editingNote.metadata?.transcript) {
      source = "transcript";
    }

    const normalizedSelected = selectedText.trim();
    const mergedMetadata = normalizedSelected
      ? {
          ...(editingNote.metadata ?? {}),
          selectedText: normalizedSelected,
        }
      : editingNote.metadata ?? undefined;

    await handleSaveNote({
      text: noteText,
      source,
      sourceId: editingNote.metadata?.chat?.messageId ?? null,
      metadata: mergedMetadata,
    });

    // Clear editing state
    setEditingNote(null);
  }, [editingNote, videoId, handleSaveNote]);

  const handleCancelEditing = useCallback(() => {
    setEditingNote(null);
  }, []);

  const handleExportDialogOpenChange = useCallback((open: boolean) => {
    setIsExportDialogOpen(open);
    if (!open) {
      setExportErrorMessage(null);
      setExportDisableMessage(null);
    }
  }, []);

  const handleRequestExport = useCallback(async () => {
    if (!videoId || transcript.length === 0) {
      toast.error('Transcript is still loading. Try again in a few seconds.');
      return;
    }

    if (!user) {
      storeCurrentVideoForAuth();
      setAuthModalTrigger('manual');
      setAuthModalOpen(true);
      return;
    }

    const status = await fetchSubscriptionStatus();
    if (!status) {
      return;
    }

    if (status.tier !== 'pro') {
      setShowExportUpsell(true);
      return;
    }

    if (!isProSubscriptionActive(status)) {
      setExportDisableMessage('Your subscription is not active. Visit billing to reactivate and continue exporting transcripts.');
      setExportErrorMessage(null);
      setIsExportDialogOpen(true);
      return;
    }

    if (status.usage.totalRemaining <= 0) {
      setExportDisableMessage('You’ve hit your export limit. Purchase a top-up or wait for your cycle reset.');
      setExportErrorMessage(null);
      setIsExportDialogOpen(true);
      return;
    }

    setExportDisableMessage(null);
    setExportErrorMessage(null);
    setIsExportDialogOpen(true);
  }, [
    videoId,
    transcript.length,
    user,
    storeCurrentVideoForAuth,
    setAuthModalTrigger,
    setAuthModalOpen,
    fetchSubscriptionStatus,
  ]);

  const handleConfirmExport = useCallback(async () => {
    if (transcript.length === 0) {
      setExportErrorMessage('Transcript is still loading. Please try again.');
      return;
    }

    const status = await fetchSubscriptionStatus();
    if (!status) {
      setExportErrorMessage('Unable to verify your subscription. Please try again.');
      return;
    }

    if (status.tier !== 'pro') {
      setShowExportUpsell(true);
      setIsExportDialogOpen(false);
      return;
    }

    if (!isProSubscriptionActive(status)) {
      setExportDisableMessage('Your subscription is not active. Visit billing to reactivate and continue exporting transcripts.');
      return;
    }

    if (status.usage.totalRemaining <= 0) {
      setExportDisableMessage('You’ve hit your export limit. Purchase a top-up or wait for your cycle reset.');
      return;
    }

    setIsExportingTranscript(true);
    setExportErrorMessage(null);

    try {
      const { blob, filename } = createTranscriptExport(transcript, {
        format: exportFormat,
        includeSpeakers: includeSpeakers && hasSpeakerData,
        includeTimestamps: exportFormat === 'srt' ? true : includeTimestamps,
        videoTitle: videoInfo?.title,
        videoAuthor: videoInfo?.author,
        topics,
      });

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);

      toast.success('Transcript export started');
      setIsExportDialogOpen(false);
      setExportDisableMessage(null);
      await fetchSubscriptionStatus({ force: true });
    } catch (error) {
      console.error('Transcript export failed:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to export transcript. Please try again.';
      setExportErrorMessage(message);
      toast.error("We couldn't generate that export. Try again in a moment.");
    } finally {
      setIsExportingTranscript(false);
    }
  }, [
    transcript,
    fetchSubscriptionStatus,
    exportFormat,
    includeSpeakers,
    hasSpeakerData,
    includeTimestamps,
    videoInfo,
    topics,
  ]);

  const handleUpgradeClick = useCallback(() => {
    router.push('/pricing');
  }, [router]);

  const exportButtonState = useMemo(() => {
    if (!videoId || transcript.length === 0) {
      return {
        disabled: true,
        tooltip: 'Transcript is still loading',
      };
    }

    if (isExportingTranscript) {
      return {
        disabled: true,
        isLoading: true,
        tooltip: 'Preparing export…',
      };
    }

    if (isCheckingSubscription) {
      return {
        disabled: true,
        isLoading: true,
        tooltip: 'Checking export availability…',
      };
    }

    if (!user) {
      return {
        badgeLabel: 'Pro',
        tooltip: 'Sign in to export transcripts',
      };
    }

    if (subscriptionStatus && subscriptionStatus.tier !== 'pro') {
      return {
        badgeLabel: 'Pro',
        tooltip: 'Upgrade to Pro to export transcripts',
      };
    }

    if (subscriptionStatus && !isProSubscriptionActive(subscriptionStatus)) {
      return {
        badgeLabel: 'Pro',
        tooltip: 'Reactivate your subscription to export transcripts',
      };
    }

    if (subscriptionStatus && subscriptionStatus.usage.totalRemaining <= 0) {
      return {
        badgeLabel: 'Pro',
        tooltip: 'You’ve hit your export limit. Purchase a top-up or wait for reset.',
      };
    }

    return {
      tooltip: 'Export transcript',
    };
  }, [
    videoId,
    transcript.length,
    isExportingTranscript,
    isCheckingSubscription,
    user,
    subscriptionStatus,
  ]);

  return (
    <div className="min-h-screen bg-white pt-12 pb-2">
      {pageState === 'IDLE' && !videoId && !routeVideoId && !urlParam && (
        <section className="flex min-h-[calc(100vh-11rem)] flex-col items-center justify-center px-5 text-center">
          {error && (
            <div className="mb-6 w-full max-w-2xl">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-600 shadow-sm">
                {error}
              </div>
            </div>
          )}
          <Card className="w-full max-w-2xl border border-dashed border-slate-200 bg-white/80 p-9 backdrop-blur-sm">
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-900">Ready to analyze a video?</h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Head back to the home page to paste a YouTube link and generate highlight reels, searchable transcripts, and AI takeaways.
              </p>
              <div className="pt-1">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-[#f8fafc]"
                >
                  Go to home
                </Link>
              </div>
            </div>
          </Card>
        </section>
      )}

      {pageState === 'LOADING_CACHED' && (
        <section className="flex min-h-[calc(100vh-11rem)] items-center justify-center px-5">
          <div className="w-full max-w-7xl">
            <VideoSkeleton />
          </div>
        </section>
      )}

      {pageState === 'ANALYZING_NEW' && (
        <section className="flex min-h-[calc(100vh-11rem)] flex-col items-center justify-center px-5">
          {error && (
            <div className="mb-6 w-full max-w-2xl">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-600 shadow-sm">
                {error}
              </div>
            </div>
          )}
          <div className="flex flex-col items-center text-center">
            <Loader2 className="mb-3.5 h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium text-slate-700">Analyzing video and generating highlight reels</p>
            <p className="mt-1.5 text-xs text-slate-500">
              {loadingStage === 'fetching' && 'Fetching transcript...'}
              {loadingStage === 'understanding' && 'Fetching transcript...'}
              {loadingStage === 'generating' && `Creating highlight reels... (${elapsedTime} seconds)`}
              {loadingStage === 'processing' && `Processing and matching quotes... (${processingElapsedTime} seconds)`}
            </p>
          </div>
          <div className="mt-10 w-full max-w-2xl">
            <LoadingContext
              videoInfo={videoInfo}
              preview={videoPreview}
            />
          </div>
          <div className="w-full max-w-2xl">
            <LoadingTips />
          </div>
        </section>
      )}

      {pageState === 'IDLE' && videoId && topics.length === 0 && error && (
        <section className="flex min-h-[calc(100vh-11rem)] flex-col items-center justify-center px-5 text-center">
          <Card className="w-full max-w-2xl border border-slate-200 bg-white/90 p-9 backdrop-blur-sm">
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {isRateLimitError ? 'Monthly limit reached' : 'We couldn\'t finish analyzing this video'}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {isRateLimitError
                    ? AUTH_LIMIT_MESSAGE
                    : error}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-[#f8fafc]"
                >
                  Go to home
                </Link>
                {isRateLimitError && (
                  <Link
                    href="/pricing"
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-700"
                  >
                    Upgrade to Pro
                  </Link>
                )}
                {!isRateLimitError && (
                  <button
                    type="button"
                    onClick={() => processVideo(normalizedUrl, mode)}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
                    disabled={isModeLoading}
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          </Card>
        </section>
      )}

      {videoId && topics.length > 0 && pageState === 'IDLE' && (
        <div className="mx-auto w-full max-w-7xl px-5 pb-5 pt-0">
          {error && (
            <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-600 shadow-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Left Column - Video (2/3 width) */}
            <div className="lg:col-span-2">
              <div className="sticky top-[6.5rem] space-y-3.5" id="video-container">
                <YouTubePlayer
                  videoId={videoId}
                  selectedTopic={selectedTopic}
                  playbackCommand={playbackCommand}
                  onCommandExecuted={clearPlaybackCommand}
                  topics={topics}
                  onTopicSelect={handleTopicSelect}
                  onTimeUpdate={handleTimeUpdate}
                  transcript={transcript}
                  isPlayingAll={isPlayingAll}
                  playAllIndex={playAllIndex}
                  onTogglePlayAll={handleTogglePlayAll}
                  setPlayAllIndex={memoizedSetPlayAllIndex}
                  setIsPlayingAll={memoizedSetIsPlayingAll}
                  renderControls={false}
                  onDurationChange={setVideoDuration}
                />
                {(themes.length > 0 || isLoadingThemeTopics || themeError || selectedTheme) && (
                  <div className="flex justify-center">
                    <ThemeSelector
                      themes={themes}
                      selectedTheme={selectedTheme}
                      onSelect={handleThemeSelect}
                      isLoading={isLoadingThemeTopics}
                      error={themeError}
                    />
                  </div>
                )}
                <HighlightsPanel
                  topics={topics}
                  selectedTopic={selectedTopic}
                  onTopicSelect={(topic) => handleTopicSelect(topic)}
                  onPlayTopic={requestPlayTopic}
                  onSeek={requestSeek}
                  onPlayAll={handleTogglePlayAll}
                  isPlayingAll={isPlayingAll}
                  playAllIndex={playAllIndex}
                  currentTime={currentTime}
                  videoDuration={videoDuration}
                  transcript={transcript}
                  isLoadingThemeTopics={isLoadingThemeTopics}
                  videoId={videoId ?? undefined}
                />
              </div>
            </div>

            {/* Right Column - Tabbed Interface (1/3 width) */}
            <div className="lg:col-span-1">
              <div
                className="sticky top-[6.5rem]"
                id="right-column-container"
                style={{ height: transcriptHeight, maxHeight: transcriptHeight }}
              >
                <RightColumnTabs
                  ref={rightColumnTabsRef}
                  transcript={transcript}
                  selectedTopic={selectedTopic}
                  onTimestampClick={handleTimestampClick}
                  currentTime={currentTime}
                  topics={topics}
                  citationHighlight={citationHighlight}
                  videoId={videoId}
                  videoTitle={videoInfo?.title}
                  videoInfo={videoInfo}
                  onCitationClick={handleCitationClick}
                  showChatTab={showChatTab}
                  cachedSuggestedQuestions={cachedSuggestedQuestions}
                  notes={notes}
                  onSaveNote={handleSaveNote}
                  onTakeNoteFromSelection={handleTakeNoteFromSelection}
                  editingNote={editingNote}
                  onSaveEditingNote={handleSaveEditingNote}
                  onCancelEditing={handleCancelEditing}
                  isAuthenticated={!!user}
                  onRequestSignIn={promptSignInForNotes}
                  onRequestExport={handleRequestExport}
                  exportButtonState={exportButtonState}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <AuthModal
        open={authModalOpen}
        onOpenChange={(open) => {
          // Store video before modal opens
          if (open && videoId && !user) {
            storeCurrentVideoForAuth();
          }
          if (!open) {
            setAuthModalTrigger('generation-limit');
          }
          setAuthModalOpen(open);
        }}
        trigger={authModalTrigger}
        onSuccess={() => {
          // Refresh rate limit info after successful auth
          checkRateLimit();
          // Check for pending video linking will happen via useEffect
        }}
        currentVideoId={videoId}
      />
      <TranscriptExportDialog
        open={isExportDialogOpen}
        onOpenChange={handleExportDialogOpenChange}
        format={exportFormat}
        onFormatChange={setExportFormat}
        includeSpeakers={includeSpeakers}
        onIncludeSpeakersChange={(value) => setIncludeSpeakers(value && hasSpeakerData)}
        includeTimestamps={includeTimestamps}
        onIncludeTimestampsChange={setIncludeTimestamps}
        disableTimestampToggle={exportFormat === 'srt'}
        onConfirm={handleConfirmExport}
        isExporting={isExportingTranscript}
        error={exportErrorMessage}
        disableDownloadMessage={exportDisableMessage}
        hasSpeakerData={hasSpeakerData}
        willConsumeTopup={subscriptionStatus?.willConsumeTopup}
        videoTitle={videoInfo?.title}
      />
      <TranscriptExportUpsell
        open={showExportUpsell}
        onOpenChange={setShowExportUpsell}
        onUpgradeClick={handleUpgradeClick}
      />
    </div>
  );
}
