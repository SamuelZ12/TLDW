"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, X } from "lucide-react";
import { TranscriptSegment, TranslationRequestHandler } from "@/lib/types";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ASPECT_RATIO_OPTIONS = [
  { value: "9:16", label: "Portrait 9:16" },
  { value: "3:4", label: "Portrait 3:4" },
  { value: "1:1", label: "Square 1:1" },
  { value: "4:3", label: "Landscape 4:3" },
  { value: "16:9", label: "Widescreen 16:9" },
  { value: "21:9", label: "Cinematic 21:9" },
];

const STYLE_OPTIONS = [
  { value: "neo-brutalism", label: "Neo-Brutalism" },
  { value: "glass", label: "Glass" },
  { value: "vintage-revival-editorial", label: "Vintage-Revival Editorial" },
  { value: "dark-mode-botanical", label: "Dark Mode Botanical" },
];

interface ImageCheatsheetCardProps {
  transcript: TranscriptSegment[];
  videoId: string;
  videoTitle?: string;
  videoAuthor?: string;
  isAuthenticated?: boolean;
  onRequestSignIn?: () => void;
  onImageGenerated?: (data: {
    imageUrl: string;
    modelUsed: string;
    remaining: number | null;
    limit: number;
    aspectRatio: string;
    style: string;
  }) => void;
  selectedLanguage?: string | null;
  onRequestTranslation?: TranslationRequestHandler;
}

interface LimitResponse {
  canGenerate: boolean;
  isAuthenticated: boolean;
  tier?: "free" | "pro" | "anonymous";
  remaining?: number | null;
  limit?: number | null;
  resetAt?: string | null;
  requiresAuth?: boolean;
  reason?: string | null;
}

// Default English labels
const DEFAULT_LABELS = {
  generateCheatsheetImage: "Generate cheatsheet image",
  generatingCheatsheet: "Generating cheatsheet...",
  selectAspectRatioStyle: "Select aspect ratio & style",
  limitReached: "Limit reached",
  aspectRatio: "Aspect ratio",
  style: "Style",
  generate: "Generate",
  cancel: "Cancel",
  left: "left",
};

export function ImageCheatsheetCard({
  transcript,
  videoId,
  videoTitle,
  videoAuthor,
  isAuthenticated,
  onRequestSignIn,
  onImageGenerated,
  selectedLanguage,
  onRequestTranslation,
}: ImageCheatsheetCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCheckingLimit, setIsCheckingLimit] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [style, setStyle] = useState<string>("neo-brutalism");

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
        onRequestTranslation(DEFAULT_LABELS.generateCheatsheetImage, `ui_cheatsheet:generateCheatsheetImage:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.generatingCheatsheet, `ui_cheatsheet:generatingCheatsheet:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.selectAspectRatioStyle, `ui_cheatsheet:selectAspectRatioStyle:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.limitReached, `ui_cheatsheet:limitReached:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.aspectRatio, `ui_cheatsheet:aspectRatio:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.style, `ui_cheatsheet:style:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.generate, `ui_cheatsheet:generate:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.cancel, `ui_cheatsheet:cancel:${selectedLanguage}`),
        onRequestTranslation(DEFAULT_LABELS.left, `ui_cheatsheet:left:${selectedLanguage}`),
      ]);

      if (!isCancelled) {
        setTranslatedLabels({
          generateCheatsheetImage: translations[0],
          generatingCheatsheet: translations[1],
          selectAspectRatioStyle: translations[2],
          limitReached: translations[3],
          aspectRatio: translations[4],
          style: translations[5],
          generate: translations[6],
          cancel: translations[7],
          left: translations[8],
        });
      }
    };

    translateLabels().catch((err) => {
      console.error("Failed to translate cheatsheet labels:", err);
      if (!isCancelled) {
        setTranslatedLabels(DEFAULT_LABELS);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedLanguage, onRequestTranslation]);

  const limitReached = useMemo(() => {
    if (!isAuthenticated) return false;
    if (remaining === null || remaining === undefined) return false;
    return remaining <= 0;
  }, [isAuthenticated, remaining]);

  const fetchLimit = useCallback(async () => {
    setIsCheckingLimit(true);
    try {
      const res = await fetch("/api/image-limit");
      const data: LimitResponse = await res.json();

      setLimit(typeof data.limit === "number" ? data.limit : null);
      setRemaining(
        typeof data.remaining === "number" || data.remaining === null
          ? data.remaining
          : null
      );
      setResetAt(data.resetAt ?? null);
    } catch (err) {
      console.error("Failed to fetch image limit", err);
    } finally {
      setIsCheckingLimit(false);
    }
  }, []);

  useEffect(() => {
    void fetchLimit();
  }, [fetchLimit]);

  const handleOpenConfigurator = useCallback(() => {
    if (!isAuthenticated) {
      onRequestSignIn?.();
      return;
    }

    if (!transcript || transcript.length === 0) {
      setError("Transcript is required before generating an image.");
      return;
    }

    setIsConfiguring(true);
    setError(null);
  }, [isAuthenticated, onRequestSignIn, transcript]);

  const handleGenerate = useCallback(async () => {
    if (!isAuthenticated) {
      onRequestSignIn?.();
      setIsConfiguring(false);
      return;
    }

    if (!transcript || transcript.length === 0) {
      setError("Transcript is required before generating an image.");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          transcript,
          videoTitle,
          videoAuthor,
          aspectRatio,
          style,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message =
          typeof data?.message === "string"
            ? data.message
            : typeof data?.error === "string"
              ? data.error
              : "Failed to generate image.";
        setError(message);
        toast.error(message);
        return;
      }

      if (typeof data.imageUrl !== "string") {
        setError("No image was returned. Please try again.");
        return;
      }

      // Update local quota state
      setRemaining(
        typeof data.remaining === "number" || data.remaining === null
          ? data.remaining
          : remaining
      );
      setLimit(typeof data.limit === "number" ? data.limit : limit);

      // Notify parent component
      onImageGenerated?.({
        imageUrl: data.imageUrl,
        modelUsed: data.modelUsed || "gemini-3-pro-image-preview",
        remaining: data.remaining,
        limit: data.limit,
        aspectRatio: data.aspectRatio || aspectRatio,
        style: data.style || style,
      });

      toast.success("Cheatsheet image generated");
      setIsConfiguring(false);
    } catch (err) {
      console.error("Error generating image", err);
      setError("Failed to generate image. Please try again.");
      toast.error("Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  }, [
    isAuthenticated,
    onRequestSignIn,
    videoId,
    transcript,
    videoTitle,
    videoAuthor,
    aspectRatio,
    style,
    remaining,
    limit,
    onImageGenerated,
  ]);

  const buttonText = useMemo(() => {
    if (isGenerating) return translatedLabels.generatingCheatsheet;
    if (isConfiguring) return translatedLabels.selectAspectRatioStyle;
    if (!isAuthenticated) return translatedLabels.generateCheatsheetImage;
    if (isCheckingLimit) return translatedLabels.generatingCheatsheet;
    if (limitReached) return translatedLabels.limitReached;
    if (remaining !== null && remaining !== undefined) {
      return `${translatedLabels.generateCheatsheetImage} (${remaining} ${translatedLabels.left})`;
    }
    return translatedLabels.generateCheatsheetImage;
  }, [isGenerating, isConfiguring, isAuthenticated, isCheckingLimit, limitReached, remaining, translatedLabels]);

  return (
    <div className="flex w-full flex-col items-end gap-2">
      {/* Trigger */}
      <Button
        variant="pill"
        size="sm"
        className="self-end w-fit h-auto max-w-full sm:max-w-[80%] justify-start text-left whitespace-normal break-words leading-snug py-2 px-4 transition-colors hover:bg-neutral-100"
        onClick={handleOpenConfigurator}
        disabled={isGenerating || limitReached || isCheckingLimit}
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2 flex-shrink-0" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2 flex-shrink-0" />
        )}
        {buttonText}
      </Button>

      {/* Inline chat-style prompt */}
      {isConfiguring && (
        <div className="w-full max-w-[80%] self-end rounded-[18px] border border-neutral-200 bg-white p-3 shadow-[0_8px_0_#00000012]">
          <div className="grid gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-neutral-600">{translatedLabels.aspectRatio}</Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger className="h-9 text-xs bg-white">
                  <SelectValue placeholder="Choose aspect ratio" />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIO_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-neutral-600">{translatedLabels.style}</Label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger className="h-9 text-xs bg-white">
                <SelectValue placeholder="Choose style" />
              </SelectTrigger>
              <SelectContent>
                {STYLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              className="h-8 px-3"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              ) : null}
              {translatedLabels.generate}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-3"
              onClick={() => setIsConfiguring(false)}
              disabled={isGenerating}
            >
              {translatedLabels.cancel}
            </Button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="w-full max-w-[80%] self-end rounded-lg bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700 flex items-start gap-2">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
