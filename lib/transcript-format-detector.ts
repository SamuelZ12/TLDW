import { TranscriptSegment } from './types';
import { mergeTranscriptSegmentsIntoSentences } from './transcript-sentence-merger';

/**
 * Detects whether a transcript is in old format (raw segments) or new format (merged sentences)
 *
 * Detection prioritizes punctuation ratio as the primary indicator:
 *
 * Old format characteristics:
 * - Segments break mid-sentence (e.g., "AI automations are becoming more")
 * - Low sentence-ending punctuation ratio (< 15%)
 * - Typical segment length: 5-7 words (~30-40 chars)
 * - Example: Only 5-12% of segments end with punctuation
 *
 * New format characteristics:
 * - Segments align with sentence boundaries (e.g., "AI automations are becoming more powerful than ever.")
 * - High sentence-ending punctuation ratio (> 80%)
 * - Typical segment length: Full sentences (~100-200 chars)
 * - Example: 100% of segments end with proper punctuation
 *
 * For edge cases (15-80% punctuation ratio), uses average text length as tiebreaker.
 */
export function detectTranscriptFormat(
  transcript: TranscriptSegment[]
): 'old' | 'new' {
  if (!transcript || transcript.length === 0) {
    return 'new'; // Default to new format for empty transcripts
  }

  // Sample first 100 segments for analysis (or all if fewer)
  const sampleSize = Math.min(100, transcript.length);
  const sample = transcript.slice(0, sampleSize);

  // Calculate average text length
  const totalTextLength = sample.reduce((sum, seg) => sum + (seg.text?.length || 0), 0);
  const avgTextLength = totalTextLength / sampleSize;

  // Calculate percentage of segments ending with sentence punctuation
  const sentenceEndingRegex = /[.!?\u3002\uff01\uff1f\u203c\u2047\u2048]\s*$/;
  const sentenceEndingCount = sample.filter(seg =>
    sentenceEndingRegex.test(seg.text?.trim() || '')
  ).length;
  const sentenceEndingRatio = sentenceEndingCount / sampleSize;

  // Prioritize punctuation ratio as the primary indicator
  // OLD format: Most segments break mid-sentence (low punctuation ratio)
  if (sentenceEndingRatio < 0.15) {
    return 'old';
  }

  // NEW format: Most segments end at sentence boundaries (high punctuation ratio)
  if (sentenceEndingRatio > 0.80) {
    return 'new';
  }

  // Medium punctuation ratio (15-80%): Use text length as tiebreaker
  // Longer segments more likely to be merged sentences
  return avgTextLength > 40 ? 'new' : 'old';
}

/**
 * Ensures transcript is in the new merged sentence format.
 * If transcript is detected to be in old format, it will be migrated to new format.
 *
 * @param transcript - The transcript to check and potentially migrate
 * @param options - Optional configuration
 * @returns Transcript in merged sentence format
 */
export function ensureMergedFormat(
  transcript: TranscriptSegment[],
  options?: {
    /** Enable logging for format detection and migration */
    enableLogging?: boolean;
    /** Context info for logging (e.g., video ID) */
    context?: string;
  }
): TranscriptSegment[] {
  if (!transcript || transcript.length === 0) {
    return transcript;
  }

  const format = detectTranscriptFormat(transcript);

  if (format === 'old') {
    if (options?.enableLogging) {
      console.log(`[Transcript Format] Detected old format transcript${options.context ? ` for ${options.context}` : ''}. Applying runtime sentence merging (cache not updated)...`);
      console.log(`[Transcript Format] Original segments: ${transcript.length}`);
    }

    // Migrate old format to new format using sentence merger
    const mergedSentences = mergeTranscriptSegmentsIntoSentences(transcript);

    // Transform merged sentences to TranscriptSegment format
    const migratedTranscript: TranscriptSegment[] = mergedSentences.map(sentence => ({
      text: sentence.text,
      start: sentence.segments[0].start,
      duration: sentence.segments.reduce((sum, seg) => sum + seg.duration, 0)
    }));

    if (options?.enableLogging) {
      console.log(`[Transcript Format] Merged segments: ${migratedTranscript.length}`);
      console.log(`[Transcript Format] Segment reduction: ${((1 - migratedTranscript.length / transcript.length) * 100).toFixed(1)}%`);
    }

    return migratedTranscript;
  }

  if (options?.enableLogging) {
    console.log(`[Transcript Format] Transcript already in merged format${options.context ? ` for ${options.context}` : ''}.`);
  }

  return transcript;
}

/**
 * Gets statistics about a transcript format for debugging/monitoring
 */
export function getTranscriptFormatStats(transcript: TranscriptSegment[]) {
  if (!transcript || transcript.length === 0) {
    return {
      segmentCount: 0,
      avgTextLength: 0,
      sentenceEndingRatio: 0,
      format: 'unknown' as const
    };
  }

  const sampleSize = Math.min(100, transcript.length);
  const sample = transcript.slice(0, sampleSize);

  const totalTextLength = sample.reduce((sum, seg) => sum + (seg.text?.length || 0), 0);
  const avgTextLength = totalTextLength / sampleSize;

  const sentenceEndingRegex = /[.!?\u3002\uff01\uff1f\u203c\u2047\u2048]\s*$/;
  const sentenceEndingCount = sample.filter(seg =>
    sentenceEndingRegex.test(seg.text?.trim() || '')
  ).length;
  const sentenceEndingRatio = sentenceEndingCount / sampleSize;

  return {
    segmentCount: transcript.length,
    avgTextLength: Math.round(avgTextLength * 10) / 10,
    sentenceEndingRatio: Math.round(sentenceEndingRatio * 100) / 100,
    format: detectTranscriptFormat(transcript)
  };
}
