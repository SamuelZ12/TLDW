import { TranscriptSegment } from './types';

// Hard safeguards so we never return a single, video-length "sentence" when
// captions don't include punctuation (common with auto-generated transcripts).
const MAX_SENTENCE_DURATION_SECONDS = 24; // keep chunks short for navigation
const MAX_SENTENCE_WORDS = 80;
const MAX_SEGMENTS_PER_SENTENCE = 20;

// Hoisted constants for performance
const COMMON_TLDS = [
  'com', 'org', 'net', 'edu', 'gov', 'co', 'io', 'ai', 'dev',
  'txt', 'pdf', 'jpg', 'png', 'gif', 'doc', 'zip', 'html', 'js', 'ts'
];
const COMMON_ABBREVS = ['dr', 'mr', 'mrs', 'ms', 'vs', 'etc', 'inc', 'ltd', 'jr', 'sr'];

// Regex constants
const SENTENCE_PUNCTUATION_REGEX = /[.!?\u3002\uff01\uff1f\u203c\u2047\u2048]/g;
const WHITESPACE_GLOBAL_REGEX = /\s+/g;
const PUNCTUATION_OR_SPACE_REGEX = /[\s,;!?]/;
const DIGIT_REGEX = /\d/;
const NON_PERIOD_SENTENCE_ENDING_REGEX = /[!?\u3002\uff01\uff1f\u203c\u2047\u2048]$/;

/**
 * Represents a merged sentence from multiple transcript segments
 */
export interface MergedSentence {
  text: string;
  startIndex: number; // Index of first segment
  endIndex: number; // Index of last segment (inclusive)
  segments: TranscriptSegment[]; // Original segments that make up this sentence
}

function countWords(text: string): number {
  if (!text) return 0;
  // Use a more efficient counting method that avoids creating an array of strings
  let count = 0;
  let inWord = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const isSpace = /\s/.test(text[i]);
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

function splitLongSentence(sentence: MergedSentence): MergedSentence[] {
  const chunks: MergedSentence[] = [];

  let chunkSegments: TranscriptSegment[] = [];
  let chunkWordCount = 0;
  let chunkDuration = 0;
  let chunkStartIndex = sentence.startIndex;

  const pushChunk = (endIndex: number) => {
    if (chunkSegments.length === 0) return;
    chunks.push({
      text: chunkSegments.map((s) => s.text).join(' ').replace(WHITESPACE_GLOBAL_REGEX, ' ').trim(),
      startIndex: chunkStartIndex,
      endIndex,
      segments: [...chunkSegments],
    });
  };

  sentence.segments.forEach((segment, idx) => {
    const segmentWords = countWords(segment.text || '');
    const segmentDuration = Math.max(segment.duration || 0, 0);
    const nextDuration = chunkDuration + segmentDuration;
    const nextWords = chunkWordCount + segmentWords;
    const nextSegmentCount = chunkSegments.length + 1;

    const exceedsDuration =
      chunkSegments.length > 0 && nextDuration > MAX_SENTENCE_DURATION_SECONDS;
    const exceedsWords =
      chunkSegments.length > 0 && nextWords > MAX_SENTENCE_WORDS;
    const exceedsSegments =
      chunkSegments.length > 0 && nextSegmentCount > MAX_SEGMENTS_PER_SENTENCE;

    if (exceedsDuration || exceedsWords || exceedsSegments) {
      const endIndex = chunkStartIndex + chunkSegments.length - 1;
      pushChunk(endIndex);
      // Reset accumulators for new chunk starting at current segment
      chunkSegments = [];
      chunkWordCount = 0;
      chunkDuration = 0;
      chunkStartIndex = sentence.startIndex + idx;
    }

    chunkSegments.push(segment);
    chunkWordCount += segmentWords;
    chunkDuration += segmentDuration;
  });

  pushChunk(chunkStartIndex + chunkSegments.length - 1);
  return chunks;
}

/**
 * Check if a period at the given position is truly sentence-ending
 * Returns false for decimal numbers, URLs, abbreviations, file extensions
 */
function isSentenceEndingPeriod(text: string, periodIndex: number): boolean {
  // Get characters before and after the period
  const before = text.charAt(periodIndex - 1);
  const after = text.charAt(periodIndex + 1);

  // Decimal number: digit before and digit after (e.g., "2.2", "3.14")
  if (DIGIT_REGEX.test(before) && DIGIT_REGEX.test(after)) {
    return false;
  }

  // Check for common TLDs and file extensions (e.g., ".com", ".org", ".txt")
  // Look at the next few characters after the period
  const afterPeriod = text.slice(periodIndex + 1, periodIndex + 5).toLowerCase();

  for (const pattern of COMMON_TLDS) {
    // Check if pattern matches and is followed by space, punctuation, or end of string
    if (afterPeriod.startsWith(pattern)) {
      const charAfterPattern = text.charAt(periodIndex + 1 + pattern.length);
      if (!charAfterPattern || PUNCTUATION_OR_SPACE_REGEX.test(charAfterPattern)) {
        return false; // It's a TLD or file extension
      }
    }
  }

  // Common abbreviations (check 1-3 chars before period)
  const beforePeriod = text.slice(Math.max(0, periodIndex - 3), periodIndex).toLowerCase();

  for (const abbrev of COMMON_ABBREVS) {
    if (beforePeriod.endsWith(abbrev)) {
      return false;
    }
  }

  // If none of the above patterns match, it's likely a sentence-ending period
  return true;
}

/**
 * Check if text ends with a sentence-ending punctuation
 */
function endsWithSentence(text: string): boolean {
  const trimmed = text.trim();

  // Check for non-period sentence endings: question mark, exclamation, or Chinese/Japanese punctuation
  if (NON_PERIOD_SENTENCE_ENDING_REGEX.test(trimmed)) {
    return true;
  }

  // Check for period - need to verify it's truly sentence-ending
  if (trimmed.endsWith('.')) {
    const periodIndex = trimmed.length - 1;
    return isSentenceEndingPeriod(trimmed, periodIndex);
  }

  return false;
}

/**
 * Find sentence-ending punctuation near the beginning of text (within first 2 words)
 * Returns the index position right after the punctuation, or -1 if none found
 */
function findEarlyPunctuation(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return -1;

  // Find all punctuation positions
  const matches: number[] = [];
  let match;
  // Reset lastIndex because regex is global and reused
  SENTENCE_PUNCTUATION_REGEX.lastIndex = 0;
  while ((match = SENTENCE_PUNCTUATION_REGEX.exec(trimmed)) !== null) {
    matches.push(match.index);
  }

  if (matches.length === 0) return -1;

  // Filter to only include truly sentence-ending punctuation
  const sentenceEndingMatches = matches.filter(index => {
    const char = trimmed.charAt(index);

    // Non-period punctuation is always sentence-ending
    if (char !== '.') {
      return true;
    }

    // For periods, check if they're truly sentence-ending
    return isSentenceEndingPeriod(trimmed, index);
  });

  if (sentenceEndingMatches.length === 0) return -1;

  // Get the first true sentence-ending punctuation position
  const firstPuncIndex = sentenceEndingMatches[0];

  // Get text before the punctuation
  const beforePunc = trimmed.slice(0, firstPuncIndex).trim();

  // Count words before punctuation
  const wordsBefore = countWords(beforePunc);

  // If 0-2 words before punctuation, this is early punctuation
  if (wordsBefore >= 0 && wordsBefore <= 2) {
    return firstPuncIndex + 1; // Return position right after punctuation
  }

  return -1;
}

/**
 * Find sentence-ending punctuation near the end of text (within last 2 words)
 * Returns the index position right after the punctuation, or -1 if none found
 */
function findLatePunctuation(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return -1;

  // Find all punctuation positions
  const matches: number[] = [];
  let match;
  // Reset lastIndex because regex is global and reused
  SENTENCE_PUNCTUATION_REGEX.lastIndex = 0;
  while ((match = SENTENCE_PUNCTUATION_REGEX.exec(trimmed)) !== null) {
    matches.push(match.index);
  }

  if (matches.length === 0) return -1;

  // Filter to only include truly sentence-ending punctuation
  const sentenceEndingMatches = matches.filter(index => {
    const char = trimmed.charAt(index);

    // Non-period punctuation is always sentence-ending
    if (char !== '.') {
      return true;
    }

    // For periods, check if they're truly sentence-ending
    return isSentenceEndingPeriod(trimmed, index);
  });

  if (sentenceEndingMatches.length === 0) return -1;

  // Get the last true sentence-ending punctuation position
  const lastPuncIndex = sentenceEndingMatches[sentenceEndingMatches.length - 1];

  // Get text after the punctuation
  const afterPunc = trimmed.slice(lastPuncIndex + 1).trim();

  // Count words after punctuation
  const wordsAfter = countWords(afterPunc);

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

    // Check for early punctuation (within first 2 words)
    // This handles cases like ". You should" that should attach to previous sentence
    const earlySplitPos = findEarlyPunctuation(text);
    if (earlySplitPos > 0 && currentSentence.length > 0) {
      // Split the text at the early punctuation
      const beforeEarlyPunc = text.slice(0, earlySplitPos).trim();
      const afterEarlyPunc = text.slice(earlySplitPos).trim();

      // Add text before punctuation (including punctuation) to current sentence
      if (beforeEarlyPunc) {
        currentSentence.push(beforeEarlyPunc);
      }
      currentSegments.push(segment);

      // Complete the current sentence
      merged.push({
        text: currentSentence.join(' ').replace(WHITESPACE_GLOBAL_REGEX, ' ').trim(),
        startIndex,
        endIndex: i,
        segments: [...currentSegments]
      });

      // Reset for next sentence
      currentSentence = [];
      currentSegments = [];

      // Continue processing the rest of the text after early punctuation
      if (afterEarlyPunc) {
        text = afterEarlyPunc;
        // Don't set startIndex yet - will be set below when adding to sentence
      } else {
        // No more text in this segment after early punctuation
        continue;
      }
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
        text: currentSentence.join(' ').replace(WHITESPACE_GLOBAL_REGEX, ' ').trim(),
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
        text: currentSentence.join(' ').replace(WHITESPACE_GLOBAL_REGEX, ' ').trim(),
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
      text: currentSentence.join(' ').replace(WHITESPACE_GLOBAL_REGEX, ' ').trim(),
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

  // Safety net: break up extremely long "sentences" (common when captions lack punctuation)
  const boundedMerged: MergedSentence[] = merged.flatMap(splitLongSentence);

  return boundedMerged;
}
