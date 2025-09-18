'use client'

import { useState } from 'react';
import { formatDuration } from '@/lib/utils';
import { Calendar, Clock, Play, Star, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import Link from 'next/link';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);

  const filteredVideos = videos.filter(userVideo => {
    const matchesSearch = userVideo.video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          userVideo.video.author?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFavorite = !showFavorites || userVideo.is_favorite;
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

  return (
    <>
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            type="text"
            placeholder="Search your videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={showFavorites ? "default" : "outline"}
          onClick={() => setShowFavorites(!showFavorites)}
        >
          <Star className={`h-4 w-4 ${showFavorites ? 'fill-current' : ''}`} />
          <span className="ml-2">Favorites</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredVideos.map((userVideo) => (
          <Link
            key={userVideo.id}
            href={`/?v=${userVideo.video.youtube_id}&cached=true`}
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
                  <div className="bg-white/90 rounded-full p-3">
                    <Play className="h-8 w-8 text-black fill-black" />
                  </div>
                </div>
                <div className="absolute bottom-2 right-2 bg-black/80 text-white px-2 py-1 rounded text-xs">
                  {formatDuration(userVideo.video.duration)}
                </div>
              </div>

              <div className="p-4">
                <h3 className="font-semibold line-clamp-2 mb-2 group-hover:text-primary transition-colors">
                  {userVideo.video.title}
                </h3>

                <p className="text-sm text-muted-foreground mb-3 line-clamp-1">
                  {userVideo.video.author}
                </p>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>{formatDate(userVideo.accessed_at)}</span>
                  </div>

                  {userVideo.video.topics && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{userVideo.video.topics.length}</span>
                      <span>highlights</span>
                    </div>
                  )}
                </div>

                {userVideo.is_favorite && (
                  <div className="mt-2">
                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {filteredVideos.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
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