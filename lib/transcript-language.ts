interface TranscriptLikeSegment {
  text?: string | null;
  content?: string | null;
  lang?: string | null;
  language?: string | null;
}

export interface TranscriptLanguageOptions {
  sampleSegments?: number;
  minEnglishRatio?: number;
  strictCjkThreshold?: number;
}

export interface TranscriptLanguageAssessment {
  isEnglish: boolean;
  reason:
    | 'NO_TRANSCRIPT'
    | 'REPORTED_ENGLISH'
    | 'REPORTED_NON_ENGLISH'
    | 'EMPTY_SAMPLE'
    | 'LOW_ENGLISH_RATIO'
    | 'CJK_DOMINANT'
    | 'RATIO_THRESHOLD';
  englishRatio?: number;
}

const DEFAULT_SAMPLE_SEGMENTS = 120;
const DEFAULT_MIN_ENGLISH_RATIO = 0.1;
const DEFAULT_CJK_RATIO_THRESHOLD = 0.2;
const CJK_REGEX = /[\u3400-\u9FFF]/;

function extractSegmentLanguage(segment: unknown): string | null {
  if (!segment || typeof segment !== 'object') {
    return null;
  }

  const candidate =
    (segment as TranscriptLikeSegment).lang ??
    (segment as TranscriptLikeSegment).language ??
    null;

  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim().toLowerCase();
  }

  return null;
}

function extractSegmentText(segment: unknown): string {
  if (!segment || typeof segment !== 'object') {
    return '';
  }

  const { text, content } = segment as TranscriptLikeSegment;
  const value = typeof text === 'string' ? text : typeof content === 'string' ? content : '';
  return value;
}

export function assessTranscriptLanguage(
  transcript: unknown,
  options: TranscriptLanguageOptions = {}
): TranscriptLanguageAssessment {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return { isEnglish: false, reason: 'NO_TRANSCRIPT' };
  }

  const reportedLanguages = transcript
    .map(extractSegmentLanguage)
    .filter((lang): lang is string => Boolean(lang));

  if (reportedLanguages.length > 0) {
    const hasEnglish = reportedLanguages.some(
      (lang) => lang === 'en' || lang.startsWith('en-')
    );
    return {
      isEnglish: hasEnglish,
      reason: hasEnglish ? 'REPORTED_ENGLISH' : 'REPORTED_NON_ENGLISH',
    };
  }

  const sampleLimit = options.sampleSegments ?? DEFAULT_SAMPLE_SEGMENTS;
  const sampleText = transcript
    .slice(0, sampleLimit)
    .map(extractSegmentText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sampleText) {
    return { isEnglish: false, reason: 'EMPTY_SAMPLE' };
  }

  const textWithoutSpaces = sampleText.replace(/\s/g, '');
  const nonSpaceLength = textWithoutSpaces.length;
  if (nonSpaceLength === 0) {
    return { isEnglish: false, reason: 'EMPTY_SAMPLE' };
  }

  const englishLetterCount = (textWithoutSpaces.match(/[A-Za-z]/g) ?? []).length;
  const englishRatio = englishLetterCount / nonSpaceLength;
  const cjkCharacterPresent = CJK_REGEX.test(sampleText);
  const minEnglishRatio = options.minEnglishRatio ?? DEFAULT_MIN_ENGLISH_RATIO;
  const strictCjkThreshold = options.strictCjkThreshold ?? DEFAULT_CJK_RATIO_THRESHOLD;

  if (cjkCharacterPresent && englishRatio < strictCjkThreshold) {
    return { isEnglish: false, reason: 'CJK_DOMINANT', englishRatio };
  }

  if (englishRatio < minEnglishRatio) {
    return { isEnglish: false, reason: 'LOW_ENGLISH_RATIO', englishRatio };
  }

  return { isEnglish: true, reason: 'RATIO_THRESHOLD', englishRatio };
}

export function isTranscriptEnglish(
  transcript: unknown,
  options?: TranscriptLanguageOptions
): boolean {
  return assessTranscriptLanguage(transcript, options).isEnglish;
}
