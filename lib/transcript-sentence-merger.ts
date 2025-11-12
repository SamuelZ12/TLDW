import { TranscriptSegment } from './types';

/**
 * Represents a merged sentence from multiple transcript segments
 */
export interface MergedSentence {
  text: string;
  startIndex: number; // Index of first segment
  endIndex: number; // Index of last segment (inclusive)
  segments: TranscriptSegment[]; // Original segments that make up this sentence
}

/**
 * Check if text ends with a sentence-ending punctuation
 */
function endsWithSentence(text: string): boolean {
  const trimmed = text.trim();
  // Check for sentence endings: period, question mark, exclamation, or Chinese/Japanese punctuation
  return /[.!?\u3002\uff01\uff1f\u203c\u2047\u2048]$/.test(trimmed);
}

/**
 * Find sentence-ending punctuation near the end of text (within last 2 words)
 * Returns the index position right after the punctuation, or -1 if none found
 */
function findLatePunctuation(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return -1;

  // Regex to find sentence-ending punctuation
  const sentencePunctuationRegex = /[.!?\u3002\uff01\uff1f\u203c\u2047\u2048]/g;

  // Find all punctuation positions
  const matches: number[] = [];
  let match;
  while ((match = sentencePunctuationRegex.exec(trimmed)) !== null) {
    matches.push(match.index);
  }

  if (matches.length === 0) return -1;

  // Get the last punctuation position
  const lastPuncIndex = matches[matches.length - 1];

  // Get text after the punctuation
  const afterPunc = trimmed.slice(lastPuncIndex + 1).trim();

  // Count words after punctuation
  const wordsAfter = afterPunc ? afterPunc.split(/\s+/).length : 0;

  // If 1-2 words after punctuation, we should split here
  if (wordsAfter >= 1 && wordsAfter <= 2) {
    return lastPuncIndex + 1; // Return position right after punctuation
  }

  return -1;
}

/**
 * Merge transcript segments into complete sentences for better translation quality
 *
 * @param segments - Array of transcript segments
 * @returns Array of merged sentences with their segment indices
 */
export function mergeTranscriptSegmentsIntoSentences(
  segments: TranscriptSegment[]
): MergedSentence[] {
  if (!segments || segments.length === 0) {
    return [];
  }

  const merged: MergedSentence[] = [];
  let currentSentence: string[] = [];
  let currentSegments: TranscriptSegment[] = [];
  let startIndex = 0;
  let carryoverText = ''; // Text to prepend to next segment

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    let text = segment.text || '';

    // Prepend carryover text from previous segment split
    if (carryoverText) {
      text = carryoverText + ' ' + text;
      carryoverText = '';
    }

    // Skip empty segments
    if (!text.trim()) {
      // If we have accumulated text, still count this as part of the sentence
      if (currentSentence.length > 0) {
        currentSegments.push(segment);
      }
      continue;
    }

    // Check for late punctuation (within last 2 words)
    const splitPos = findLatePunctuation(text);
    if (splitPos > 0) {
      // Split the text at the punctuation
      const beforePunc = text.slice(0, splitPos).trim();
      const afterPunc = text.slice(splitPos).trim();

      // Add text before punctuation to current sentence
      if (currentSentence.length === 0) {
        startIndex = i;
      }
      if (beforePunc) {
        currentSentence.push(beforePunc);
      }
      currentSegments.push(segment);

      // Complete the current sentence
      merged.push({
        text: currentSentence.join(' ').replace(/\s+/g, ' ').trim(),
        startIndex,
        endIndex: i,
        segments: [...currentSegments]
      });

      // Reset for next sentence
      currentSentence = [];
      currentSegments = [];

      // Store text after punctuation as carryover for next segment
      if (afterPunc) {
        carryoverText = afterPunc;
      }
      continue;
    }

    // Add this segment to current sentence
    if (currentSentence.length === 0) {
      startIndex = i;
    }
    currentSentence.push(text);
    currentSegments.push(segment);

    // Check if this segment ends a sentence
    if (endsWithSentence(text)) {
      // Complete the current sentence
      merged.push({
        text: currentSentence.join(' ').replace(/\s+/g, ' ').trim(),
        startIndex,
        endIndex: i,
        segments: [...currentSegments]
      });

      // Reset for next sentence
      currentSentence = [];
      currentSegments = [];
    }
  }

  // Handle remaining text that didn't end with sentence punctuation
  if (currentSentence.length > 0) {
    merged.push({
      text: currentSentence.join(' ').replace(/\s+/g, ' ').trim(),
      startIndex,
      endIndex: segments.length - 1,
      segments: [...currentSegments]
    });
  }

  // Handle any remaining carryover text from last segment
  if (carryoverText.trim()) {
    merged.push({
      text: carryoverText.trim(),
      startIndex: segments.length - 1,
      endIndex: segments.length - 1,
      segments: [segments[segments.length - 1]]
    });
  }

  return merged;
}
