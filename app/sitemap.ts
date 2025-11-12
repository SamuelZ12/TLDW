import { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  // Fetch all videos with their slugs and update times
  const { data: videos } = await supabase
    .from('video_analyses')
    .select('slug, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50000); // Google's sitemap limit

  // Generate URLs for all video pages
  const videoUrls: MetadataRoute.Sitemap = (videos || [])
    .filter(video => video.slug) // Only include videos with slugs
    .map(video => ({
      url: `https://tldw.us/v/${video.slug}`,
      lastModified: new Date(video.updated_at),
      changeFrequency: 'monthly' as const,
      priority: 0.8
    }));

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
