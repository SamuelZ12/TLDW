"use client";

import { useState } from "react";
import { VideoInfo } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star, Clock, User, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";

interface VideoHeaderProps {
  videoInfo: VideoInfo;
  videoId: string;
  isFavorite?: boolean;
  onFavoriteToggle?: (newStatus: boolean) => void;
}

export function VideoHeader({
  videoInfo,
  videoId,
  isFavorite = false,
  onFavoriteToggle
}: VideoHeaderProps) {
  const { user } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [favoriteStatus, setFavoriteStatus] = useState(isFavorite);

  const handleToggleFavorite = async () => {
    if (!user) {
      toast.error("Please sign in to save favorites");
      return;
    }

    setIsUpdating(true);
    try {
      const response = await fetch("/api/toggle-favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: videoId,
          isFavorite: !favoriteStatus
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update favorite status");
      }

      const data = await response.json();
      setFavoriteStatus(data.isFavorite);
      onFavoriteToggle?.(data.isFavorite);

      toast.success(
        data.isFavorite
          ? "Added to favorites"
          : "Removed from favorites"
      );
    } catch (error) {
      toast.error("Failed to update favorite status");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Card className="p-3 mb-5">
      <div className="flex items-start justify-between gap-3.5">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold line-clamp-2 mb-1.5">
            {videoInfo.title}
          </h2>

          <div className="flex flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              <span>{videoInfo.author}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{videoInfo.duration ? formatDuration(videoInfo.duration) : 'N/A'}</span>
            </div>
          </div>
        </div>

        {user && (
          <Button
            variant={favoriteStatus ? "default" : "outline"}
            size="sm"
            onClick={handleToggleFavorite}
            disabled={isUpdating}
            className="flex-shrink-0"
          >
            {isUpdating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Star
                className={`h-3.5 w-3.5 ${favoriteStatus ? 'fill-current' : ''}`}
              />
            )}
            <span className="ml-1.5">
              {favoriteStatus ? 'Favorited' : 'Favorite'}
            </span>
          </Button>
        )}
      </div>
    </Card>
  );
}