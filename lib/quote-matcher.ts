import { TranscriptSegment } from '@/lib/types';

// Configuration constants for quote matching
const QUOTE_MATCH_CONFIG = {
  FUZZY_MATCH_THRESHOLD: 0.85,
  MIN_FUZZY_SCORE: 0.7,
  N_GRAM_SIZE: 3,
  MIN_N_GRAM_OVERLAP: 0.5,
  SEGMENT_MERGE_GAP: 5, // seconds
  MIN_CONTEXT_DURATION: 15, // seconds
  MAX_CONTEXT_DURATION: 30, // seconds
  CONTEXT_EXTENSION: 5, // seconds to add before/after
} as const;

// Text normalization utilities
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
}

export function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    // Remove most punctuation. This makes the match robust to missing commas, etc.
    .replace(/[.,?"""''!—…–]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Fast n-gram based similarity (0-1)
export function calculateNgramSimilarity(str1: string, str2: string): number {
  if (str1.length === 0 || str2.length === 0) return 0;
  
  const ngrams1 = new Set<string>();
  const ngrams2 = new Set<string>();
  
  // Generate 3-grams
  const clean1 = str1.replace(/\s+/g, '');
  const clean2 = str2.replace(/\s+/g, '');
  
  for (let i = 0; i <= clean1.length - 3; i++) {
    ngrams1.add(clean1.substring(i, i + 3));
  }
  
  for (let i = 0; i <= clean2.length - 3; i++) {
    ngrams2.add(clean2.substring(i, i + 3));
  }
  
  if (ngrams1.size === 0 || ngrams2.size === 0) {
    // Fallback to simple substring check for very short strings
    return clean1.includes(clean2) || clean2.includes(clean1) ? 0.8 : 0;
  }
  
  // Calculate Jaccard similarity
  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) intersection++;
  }
  
  const union = ngrams1.size + ngrams2.size - intersection;
  return intersection / union;
}

// Boyer-Moore-Horspool substring search
export function boyerMooreSearch(text: string, pattern: string): number {
  if (pattern.length === 0) return 0;
  if (pattern.length > text.length) return -1;
  
  // Build bad character table
  const badChar = new Map<string, number>();
  for (let i = 0; i < pattern.length - 1; i++) {
    badChar.set(pattern[i], pattern.length - 1 - i);
  }
  
  let i = pattern.length - 1;
  while (i < text.length) {
    let j = pattern.length - 1;
    let k = i;
    while (j >= 0 && k >= 0 && text[k] === pattern[j]) {
      if (j === 0) return k;
      k--;
      j--;
    }
    const skip = (i < text.length && badChar.has(text[i])) 
      ? badChar.get(text[i])! 
      : pattern.length;
    i += skip;
  }
  
  return -1;
}

// Build a comprehensive index of the transcript
export interface TranscriptIndex {
  fullTextSpace: string;
  fullTextNewline: string;
  normalizedText: string;
  segmentBoundaries: Array<{
    segmentIdx: number;
    startPos: number;
    endPos: number;
    text: string;
    normalizedText: string;
  }>;
  wordIndex: Map<string, number[]>; // word -> [positions]
  ngramIndex: Map<string, Set<number>>; // 3-gram -> segment indices
}

export function buildTranscriptIndex(transcript: TranscriptSegment[]): TranscriptIndex {
  const segmentBoundaries: Array<{
    segmentIdx: number;
    startPos: number;
    endPos: number;
    text: string;
    normalizedText: string;
  }> = [];
  
  let fullTextSpace = '';
  let fullTextNewline = '';
  let normalizedText = '';
  const wordIndex = new Map<string, number[]>();
  const ngramIndex = new Map<string, Set<number>>();
  
  transcript.forEach((segment, idx) => {
    if (idx > 0) {
      fullTextSpace += ' ';
      fullTextNewline += '\n';
      normalizedText += ' ';
    }
    
    const segmentStartPos = fullTextSpace.length;
    const normalizedStartPos = normalizedText.length;
    const segmentNormalized = normalizeForMatching(segment.text);
    
    fullTextSpace += segment.text;
    fullTextNewline += segment.text;
    normalizedText += segmentNormalized;
    
    // Build word index for this segment
    const words = segmentNormalized.split(/\s+/);
    words.forEach((word, wordIdx) => {
      if (word.length > 2) {
        const positions = wordIndex.get(word) || [];
        positions.push(idx);
        wordIndex.set(word, positions);
      }
    });
    
    // Build n-gram index (3-grams)
    const cleanText = segmentNormalized.replace(/\s+/g, '');
    for (let i = 0; i <= cleanText.length - 3; i++) {
      const ngram = cleanText.substring(i, i + 3);
      if (!ngramIndex.has(ngram)) {
        ngramIndex.set(ngram, new Set());
      }
      ngramIndex.get(ngram)!.add(idx);
    }
    
    const boundary = {
      segmentIdx: idx,
      startPos: segmentStartPos,
      endPos: fullTextSpace.length,
      text: segment.text,
      normalizedText: segmentNormalized
    };
    segmentBoundaries.push(boundary);
  });
  
  return {
    fullTextSpace,
    fullTextNewline,
    normalizedText,
    segmentBoundaries,
    wordIndex,
    ngramIndex
  };
}

// Optimized text matching with intelligent strategy selection
export function findTextInTranscript(
  transcript: TranscriptSegment[],
  targetText: string,
  index: TranscriptIndex,
  options: {
    startIdx?: number;
    strategy?: 'exact' | 'normalized' | 'fuzzy' | 'all';
    minSimilarity?: number;
    maxSegmentWindow?: number;
  } = {}
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
  matchStrategy: string;
  similarity: number;
  confidence: number;
} | null {
  const {
    startIdx = 0,
    strategy = 'all',
    minSimilarity = QUOTE_MATCH_CONFIG.FUZZY_MATCH_THRESHOLD,
    maxSegmentWindow = 30
  } = options;
  
  // Quick exact match using Boyer-Moore
  const exactMatch = boyerMooreSearch(index.fullTextSpace, targetText);
  if (exactMatch !== -1) {
    const result = mapMatchToSegments(exactMatch, targetText.length, index);
    if (result) {
      return {
        ...result,
        matchStrategy: 'exact',
        similarity: 1.0,
        confidence: 1.0
      };
    }
  }
  
  // Try normalized match
  const normalizedTarget = normalizeWhitespace(targetText);
  const normalizedMatch = boyerMooreSearch(index.normalizedText, normalizedTarget);
  if (normalizedMatch !== -1) {
    // Map back to original segments
    const result = mapNormalizedMatchToSegments(
      normalizedMatch,
      normalizedTarget,
      index,
      targetText
    );
    if (result) {
      return {
        ...result,
        matchStrategy: 'normalized',
        similarity: 0.95,
        confidence: 0.95
      };
    }
  }
  
  // Use word index for intelligent fuzzy matching
  const targetWords = normalizeForMatching(targetText).split(/\s+/).filter(w => w.length > 2);
  if (targetWords.length > 0) {
    // Find segments containing the most target words
    const segmentScores = new Map<number, number>();
    
    for (const word of targetWords) {
      const segments = index.wordIndex.get(word) || [];
      for (const segIdx of segments) {
        if (segIdx >= startIdx) {
          segmentScores.set(segIdx, (segmentScores.get(segIdx) || 0) + 1);
        }
      }
    }
    
    // Get top scoring segments
    const scoredSegments = Array.from(segmentScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15); // Check top 15 candidates
    
    for (const [candidateIdx, score] of scoredSegments) {
      // Build a window around high-scoring segment
      const windowStart = Math.max(0, candidateIdx - 2);
      const windowEnd = Math.min(transcript.length - 1, candidateIdx + maxSegmentWindow);
      
      let combinedText = '';
      for (let i = windowStart; i <= windowEnd; i++) {
        if (i > windowStart) combinedText += ' ';
        combinedText += transcript[i].text;
        
        const normalizedCombined = normalizeForMatching(combinedText);
        const similarity = calculateNgramSimilarity(normalizeForMatching(targetText), normalizedCombined);
        
        if (similarity >= minSimilarity) {
          return {
            found: true,
            startSegmentIdx: windowStart,
            endSegmentIdx: i,
            startCharOffset: 0,
            endCharOffset: transcript[i].text.length,
            matchStrategy: 'fuzzy-ngram',
            similarity,
            confidence: Math.min(1.0, score / targetWords.length) // Ratio of matched words, clamped to [0, 1]
          };
        }
      }
    }
  }
  
  return null;
}

// Map a match position in the full text to segment boundaries
export function mapMatchToSegments(
  matchStart: number,
  matchLength: number,
  index: TranscriptIndex
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
} | null {
  const matchEnd = matchStart + matchLength;
  let startSegmentIdx = -1;
  let endSegmentIdx = -1;
  let startCharOffset = 0;
  let endCharOffset = 0;
  
  for (const boundary of index.segmentBoundaries) {
    // Find start segment
    if (startSegmentIdx === -1 && matchStart >= boundary.startPos && matchStart < boundary.endPos) {
      startSegmentIdx = boundary.segmentIdx;
      startCharOffset = matchStart - boundary.startPos;
    }
    
    // Find end segment
    if (matchEnd > boundary.startPos && matchEnd <= boundary.endPos) {
      endSegmentIdx = boundary.segmentIdx;
      endCharOffset = matchEnd - boundary.startPos;
      break;
    } else if (matchEnd > boundary.endPos) {
      endSegmentIdx = boundary.segmentIdx;
      endCharOffset = boundary.text.length;
    }
  }
  
  if (startSegmentIdx !== -1 && endSegmentIdx !== -1) {
    return {
      found: true,
      startSegmentIdx,
      endSegmentIdx,
      startCharOffset,
      endCharOffset
    };
  }
  
  return null;
}

// Map normalized match back to original segments
export function mapNormalizedMatchToSegments(
  normalizedMatchIdx: number,
  normalizedTargetText: string,
  index: TranscriptIndex,
  originalTargetText: string
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
} | null {
  // Since we have normalized text in our index, find which segment contains the match
  const matchEnd = normalizedMatchIdx + normalizedTargetText.length;
  let currentNormPos = 0;
  let startSegmentIdx = -1;
  let endSegmentIdx = -1;
  let startCharOffset = 0;
  let endCharOffset = 0;
  
  for (const boundary of index.segmentBoundaries) {
    const segmentNormLength = boundary.normalizedText.length;
    const segmentNormEnd = currentNormPos + segmentNormLength;
    
    // Find start segment
    if (startSegmentIdx === -1 && normalizedMatchIdx >= currentNormPos && normalizedMatchIdx < segmentNormEnd) {
      startSegmentIdx = boundary.segmentIdx;
      // Approximate char offset in original text
      const normOffsetInSegment = normalizedMatchIdx - currentNormPos;
      startCharOffset = Math.min(normOffsetInSegment, boundary.text.length - 1);
    }
    
    // Find end segment
    if (matchEnd > currentNormPos && matchEnd <= segmentNormEnd) {
      endSegmentIdx = boundary.segmentIdx;
      const normOffsetInSegment = matchEnd - currentNormPos;
      endCharOffset = Math.min(normOffsetInSegment, boundary.text.length);
      break;
    }
    
    currentNormPos = segmentNormEnd + 1; // Account for space between segments
  }
  
  if (startSegmentIdx !== -1 && endSegmentIdx !== -1) {
    return {
      found: true,
      startSegmentIdx,
      endSegmentIdx,
      startCharOffset,
      endCharOffset
    };
  }
  
  return null;
}