import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractVideoId(url: string): string | null {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function formatTopicDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Generate distinct colors for topics
export function getTopicColor(index: number): { bg: string; border: string; text: string } {
  const colors = [
    { bg: 'bg-blue-100', border: 'border-blue-500', text: 'text-blue-900' },
    { bg: 'bg-purple-100', border: 'border-purple-500', text: 'text-purple-900' },
    { bg: 'bg-green-100', border: 'border-green-500', text: 'text-green-900' },
    { bg: 'bg-orange-100', border: 'border-orange-500', text: 'text-orange-900' },
    { bg: 'bg-pink-100', border: 'border-pink-500', text: 'text-pink-900' },
    { bg: 'bg-teal-100', border: 'border-teal-500', text: 'text-teal-900' },
    { bg: 'bg-indigo-100', border: 'border-indigo-500', text: 'text-indigo-900' },
    { bg: 'bg-red-100', border: 'border-red-500', text: 'text-red-900' },
    { bg: 'bg-yellow-100', border: 'border-yellow-500', text: 'text-yellow-900' },
    { bg: 'bg-cyan-100', border: 'border-cyan-500', text: 'text-cyan-900' },
  ];
  return colors[index % colors.length];
}

// Custom color palette - Soft Pastels (converted from hex to HSL)
const TOPIC_COLORS = [
  '214 48% 65%',  // #7C9DD1 - Soft Blue
  '267 44% 71%',  // #B497D6 - Lavender
  '158 35% 65%',  // #86C5AC - Mint Green
  '15 85% 74%',   // #F4A582 - Coral
  '43 100% 74%',  // #FFD97D - Soft Yellow
  '320 53% 80%',  // #E8B4D4 - Rose Pink
  '192 49% 71%',  // #94CED8 - Sky Blue
];

// Simple hash function for deterministic randomization
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Seeded random number generator
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Deterministic shuffle based on seed
function seededShuffle(array: string[], seed: string): string[] {
  const shuffled = [...array];
  const hashValue = simpleHash(seed);
  
  // Fisher-Yates shuffle with seeded random
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(hashValue + i) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Get shuffled colors for a specific video
export function getShuffledTopicColors(videoId: string): string[] {
  return seededShuffle(TOPIC_COLORS, videoId);
}

// Get HSL color for dynamic theming
export function getTopicHSLColor(index: number, videoId?: string): string {
  const colors = videoId ? getShuffledTopicColors(videoId) : TOPIC_COLORS;
  return colors[index % colors.length];
}

// Re-export parseTimestamp from timestamp-utils for backward compatibility
export { parseTimestamp } from './timestamp-utils';
