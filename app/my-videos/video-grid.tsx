'use client'

import { useState } from 'react';
import { formatDuration } from '@/lib/utils';
import { Calendar, Clock, Play, Star, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';

interface VideoAnalysis {
  id: string;
  youtube_id: string;
  title: string;
  author: string;
  duration: number;
  thumbnail_url: string;
  topics: any;
  created_at: string;
}

interface UserVideo {
  id: string;
  user_id: string;
  video_id: string;
  accessed_at: string;
  is_favorite: boolean;
  notes: string | null;
  video: VideoAnalysis;
}

interface VideoGridProps {
  videos: UserVideo[];
}

export function VideoGrid({ videos }: VideoGridProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [favoriteStatuses, setFavoriteStatuses] = useState<Record<string, boolean>>(
    videos.reduce((acc, video) => ({ ...acc, [video.id]: video.is_favorite }), {})
  );
  const [updatingFavorites, setUpdatingFavorites] = useState<Set<string>>(new Set());

  const filteredVideos = videos.filter(userVideo => {
    const matchesSearch = userVideo.video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          userVideo.video.author?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFavorite = !showFavorites || favoriteStatuses[userVideo.id];
    return matchesSearch && matchesFavorite;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      if (diffInHours < 1) {
        const diffInMinutes = Math.floor(diffInHours * 60);
        return `${diffInMinutes} ${diffInMinutes === 1 ? 'minute' : 'minutes'} ago`;
      }
      const hours = Math.floor(diffInHours);
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffInHours < 24 * 7) {
      const days = Math.floor(diffInHours / 24);
      return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, userVideoId: string, videoYoutubeId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      toast.error('Please sign in to save favorites');
      return;
    }

    setUpdatingFavorites(prev => new Set(prev).add(userVideoId));
    const currentStatus = favoriteStatuses[userVideoId];
    const newStatus = !currentStatus;

    try {
      const response = await fetch('/api/toggle-favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: videoYoutubeId,
          isFavorite: newStatus
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update favorite status');
      }

      const data = await response.json();
      setFavoriteStatuses(prev => ({ ...prev, [userVideoId]: data.isFavorite }));

      toast.success(
        data.isFavorite
          ? 'Added to favorites'
          : 'Removed from favorites'
      );
    } catch (error) {
      toast.error('Failed to update favorite status');
    } finally {
      setUpdatingFavorites(prev => {
        const next = new Set(prev);
        next.delete(userVideoId);
        return next;
      });
    }
  };

  return (
    <>
      <div className="flex gap-3.5 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-muted-foreground h-3.5 w-3.5" />
          <Input
            type="text"
            placeholder="Search your videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs"
          />
        </div>
        <Button
          variant={showFavorites ? "default" : "outline"}
          onClick={() => setShowFavorites(!showFavorites)}
          className="text-xs"
        >
          <Star className={`h-3.5 w-3.5 ${showFavorites ? 'fill-current' : ''}`} />
          <span className="ml-1.5">Favorites</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredVideos.map((userVideo) => (
          <Link
            key={userVideo.id}
            href={`/analyze/${userVideo.video.youtube_id}?cached=true`}
            className="group cursor-pointer"
          >
            <div className="rounded-lg overflow-hidden border bg-card hover:shadow-lg transition-shadow duration-200">
              <div className="relative aspect-video bg-muted">
                {userVideo.video.thumbnail_url && (
                  <Image
                    src={userVideo.video.thumbnail_url}
                    alt={userVideo.video.title}
                    fill
                    className="object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                  <div className="bg-white/90 rounded-full p-2.5">
                    <Play className="h-7 w-7 text-black fill-black" />
                  </div>
                </div>
                <div className="absolute bottom-1.5 right-1.5 bg-black/80 text-white px-1.5 py-0.5 rounded text-[11px]">
                  {formatDuration(userVideo.video.duration)}
                </div>
                {user && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleToggleFavorite(e, userVideo.id, userVideo.video.youtube_id)}
                    disabled={updatingFavorites.has(userVideo.id)}
                    className="absolute top-1.5 right-1.5 h-7 w-7 bg-black/60 hover:bg-black/80 border-0 transition-all"
                    aria-label={favoriteStatuses[userVideo.id] ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {updatingFavorites.has(userVideo.id) ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                    ) : (
                      <Star
                        className={`h-3.5 w-3.5 transition-all ${
                          favoriteStatuses[userVideo.id]
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-white hover:text-yellow-400'
                        }`}
                      />
                    )}
                  </Button>
                )}
              </div>

              <div className="p-3.5">
                <h3 className="text-sm font-semibold line-clamp-2 mb-1.5 group-hover:text-primary transition-colors">
                  {userVideo.video.title}
                </h3>

                <p className="text-xs text-muted-foreground mb-2.5 line-clamp-1">
                  {userVideo.video.author}
                </p>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-2.5 w-2.5" />
                    <span>{formatDate(userVideo.accessed_at)}</span>
                  </div>

                  {userVideo.video.topics && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{userVideo.video.topics.length}</span>
                      <span>highlights</span>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </Link>
        ))}
      </div>

      {filteredVideos.length === 0 && (
        <div className="text-center py-11">
          <p className="text-xs text-muted-foreground">
            {searchQuery
              ? `No videos found matching "${searchQuery}"`
              : showFavorites
                ? "You haven't marked any videos as favorites yet"
                : "No videos found"}
          </p>
        </div>
      )}
    </>
  );
}
