"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, X } from "lucide-react";
import { TranscriptSegment } from "@/lib/types";
import { toast } from "sonner";

interface ImageCheatsheetCardProps {
  transcript: TranscriptSegment[];
  videoId: string;
  videoTitle?: string;
  isAuthenticated?: boolean;
  onRequestSignIn?: () => void;
  onImageGenerated?: (data: {
    imageUrl: string;
    modelUsed: string;
    remaining: number | null;
    limit: number;
  }) => void;
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

export function ImageCheatsheetCard({
  transcript,
  videoId,
  videoTitle,
  isAuthenticated,
  onRequestSignIn,
  onImageGenerated,
}: ImageCheatsheetCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCheckingLimit, setIsCheckingLimit] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleGenerate = useCallback(async () => {
    if (!isAuthenticated) {
      onRequestSignIn?.();
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
        body: JSON.stringify({ videoId, transcript, videoTitle }),
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
      });

      toast.success("Cheatsheet image generated");
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
    transcript,
    videoId,
    videoTitle,
    remaining,
    limit,
    onImageGenerated,
  ]);

  const resetLabel = useMemo(() => {
    if (!resetAt) return null;
    const date = new Date(resetAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString();
  }, [resetAt]);

  const buttonText = useMemo(() => {
    if (isGenerating) return "Generating cheatsheet...";
    if (!isAuthenticated) return "Generate cheatsheet image";
    if (isCheckingLimit) return "Generate cheatsheet...";
    if (limitReached) return "Limit reached";
    if (remaining !== null && remaining !== undefined) {
      return `Generate cheatsheet (${remaining} left)`;
    }
    return "Generate cheatsheet image";
  }, [isGenerating, isAuthenticated, isCheckingLimit, limitReached, remaining]);

  return (
    <div className="flex w-full flex-col items-end gap-2">
      {/* Generate Button */}
      <Button
        variant="pill"
        size="sm"
        className="self-end w-fit h-auto max-w-full sm:max-w-[80%] justify-start text-left whitespace-normal break-words leading-snug py-2 px-4 transition-colors hover:bg-neutral-100"
        onClick={handleGenerate}
        disabled={isGenerating || limitReached || isCheckingLimit}
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2 flex-shrink-0" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2 flex-shrink-0" />
        )}
        {buttonText}
      </Button>

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
