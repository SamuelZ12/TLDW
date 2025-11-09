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

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const text = segment.text || '';

    // Skip empty segments
    if (!text.trim()) {
      // If we have accumulated text, still count this as part of the sentence
      if (currentSentence.length > 0) {
        currentSegments.push(segment);
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

  return merged;
}

/**
 * Map translated sentences back to individual segment translations
 *
 * @param mergedSentences - Array of merged sentences
 * @param translations - Array of translated texts (must match length of mergedSentences)
 * @returns Map of segment index to translated text
 */
export function mapTranslationsToSegments(
  mergedSentences: MergedSentence[],
  translations: string[]
): Map<number, string> {
  const segmentTranslations = new Map<number, string>();

  if (mergedSentences.length !== translations.length) {
    console.error('[SENTENCE-MERGER] Translation count mismatch', {
      sentences: mergedSentences.length,
      translations: translations.length
    });
    return segmentTranslations;
  }

  for (let i = 0; i < mergedSentences.length; i++) {
    const sentence = mergedSentences[i];
    const translation = translations[i];

    // For now, assign the full translated sentence to each segment
    // In the future, we could try to split the translation proportionally
    for (let segIdx = sentence.startIndex; segIdx <= sentence.endIndex; segIdx++) {
      segmentTranslations.set(segIdx, translation);
    }
  }

  return segmentTranslations;
}

/**
 * Get the sentence group for a specific segment index
 *
 * @param segmentIndex - Index of the segment
 * @param mergedSentences - Array of merged sentences
 * @returns The merged sentence containing this segment, or null if not found
 */
export function getSentenceForSegment(
  segmentIndex: number,
  mergedSentences: MergedSentence[]
): MergedSentence | null {
  for (const sentence of mergedSentences) {
    if (segmentIndex >= sentence.startIndex && segmentIndex <= sentence.endIndex) {
      return sentence;
    }
  }
  return null;
}
