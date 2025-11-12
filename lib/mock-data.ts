/**
 * Mock video data for local development when Supadata API is unavailable
 * Enable by setting NEXT_PUBLIC_USE_MOCK_DATA=true in .env.local
 *
 * Note: This is separate from mock translation (NEXT_PUBLIC_USE_MOCK_TRANSLATION)
 * You can mix and match: use real video data with mock translation, or vice versa
 */

import transcriptData from '../resources/transcripts/example_1.json';

export const MOCK_VIDEO_INFO = {
  id: 'dQw4w9WgXcQ',
  title: 'Huberman Lab Essentials: Understanding Emotions',
  description:
    'Dr. Andrew Huberman discusses the science of emotions, including the role of the vagus nerve, dopamine, serotonin, and how food and nutrition impact our emotional states.',
  duration: 7500, // Approximate duration based on transcript
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  uploadDate: '2024-01-15T10:00:00Z',
  viewCount: 1245823,
  likeCount: 45341,
  tags: [
    'neuroscience',
    'emotions',
    'brain',
    'health',
    'psychology',
    'dopamine',
    'serotonin'
  ],
  channel: {
    id: 'UC2D2CMWXMOVWx7giW1n3LIg',
    name: 'Andrew Huberman'
  },
  transcriptLanguages: ['en']
};

// Use the imported transcript data
export const MOCK_TRANSCRIPT = transcriptData;

/**
 * Get mock video info for a given video ID
 */
export function getMockVideoInfo(videoId: string) {
  return {
    ...MOCK_VIDEO_INFO,
    id: videoId,
    videoId: videoId
  };
}

/**
 * Get mock transcript for a given video ID
 */
export function getMockTranscript(videoId: string) {
  return {
    content: MOCK_TRANSCRIPT,
    lang: 'en',
    availableLangs: ['en']
  };
}

/**
 * Check if mock data should be used
 */
export function shouldUseMockData(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
}
