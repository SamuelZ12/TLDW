import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/settings/',
          '/_next/',
          '/admin/',
        ]
      },
      // Allow Googlebot to crawl everything public
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: [
          '/api/',
          '/settings/',
          '/_next/',
          '/admin/',
        ]
      },
      // Allow other major search engines
      {
        userAgent: ['Bingbot', 'DuckDuckBot', 'Baiduspider'],
        allow: '/',
        disallow: [
          '/api/',
          '/settings/',
          '/_next/',
          '/admin/',
        ]
      }
    ],
    sitemap: 'https://tldw.us/sitemap.xml',
    host: 'https://tldw.us'
  };
}
