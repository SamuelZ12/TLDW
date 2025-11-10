"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Topic, TranscriptSegment, VideoInfo } from '@/lib/types';

interface VideoPageClientProps {
  videoId: string;
  initialVideo: {
    youtube_id: string;
    title: string;
    author: string;
    duration: number | null;
    thumbnail_url: string | null;
    transcript: TranscriptSegment[];
    topics: Topic[];
    videoInfo: VideoInfo;
    summary: string;
    suggested_questions?: string[] | null;
    created_at: string;
    updated_at: string;
  };
}

export function VideoPageClient({ videoId, initialVideo }: VideoPageClientProps) {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the existing analyze page with cached parameter
    // This ensures we use the existing, tested UI/UX while the server-rendered
    // page provides SEO benefits
    const url = `/analyze/${videoId}?cached=true`;
    router.replace(url);
  }, [videoId, router]);

  // Show a minimal loading state during redirect
  return (
    <div className="min-h-screen bg-white pt-12 pb-2">
      <div className="flex min-h-[calc(100vh-11rem)] items-center justify-center px-5">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
            <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
              Loading...
            </span>
          </div>
          <p className="mt-4 text-sm text-slate-600">Loading video analysis...</p>
        </div>
      </div>
    </div>
  );
}
