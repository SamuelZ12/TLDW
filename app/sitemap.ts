import { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';
import { buildVideoSlug } from '@/lib/utils';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  // Fetch all videos with their slugs and update times
  const { data: videos } = await supabase
    .from('video_analyses')
    .select('slug, updated_at, youtube_id, title')
    .order('updated_at', { ascending: false })
    .limit(50000); // Google's sitemap limit

  const normalizeSlug = (video: { slug: string | null; youtube_id: string | null; title: string | null }) => {
    const youtubeId = video.youtube_id ?? '';
    const hasCanonicalSuffix = Boolean(video.slug && youtubeId && video.slug.endsWith(youtubeId));
    const canonicalSlug = youtubeId ? buildVideoSlug(video.title, youtubeId) : null;

    if (hasCanonicalSuffix) {
      return video.slug;
    }

    return canonicalSlug || video.slug || null;
  };

  // Generate URLs for all video pages
  const videoUrls: MetadataRoute.Sitemap = (videos || [])
    .map(video => {
      const slug = normalizeSlug(video);

      if (!slug) {
        return null;
      }

      return {
        url: `https://tldw.us/v/${slug}`,
        lastModified: new Date(video.updated_at),
        changeFrequency: 'monthly' as const,
        priority: 0.8
      };
    })
    .filter(Boolean) as MetadataRoute.Sitemap;

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: 'https://tldw.us',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0
    },
    {
      url: 'https://tldw.us/pricing',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9
    },
    {
      url: 'https://tldw.us/library',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7
    }
  ];

  return [...staticPages, ...videoUrls];
}

// Revalidate sitemap every hour
export const revalidate = 3600;
