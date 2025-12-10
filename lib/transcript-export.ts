import type { TranscriptSegment, Topic } from '@/lib/types';

export type TranscriptExportFormat = 'txt' | 'srt' | 'csv';

export interface TranscriptExportOptions {
  format: TranscriptExportFormat;
  includeSpeakers?: boolean;
  includeTimestamps?: boolean;
  videoTitle?: string;
  videoAuthor?: string;
  topics?: Topic[];
}

export interface TranscriptExportResult {
  blob: Blob;
  filename: string;
}

const DEFAULT_FILENAME = 'longcut-transcript';

function formatClockTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatSrtTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millis = totalMilliseconds % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis
    .toString()
    .padStart(3, '0')}`;
}

function getSegmentSpeaker(segment: TranscriptSegment): string | undefined {
  if (!segment) return undefined;
  if (typeof (segment as any).speaker === 'string' && (segment as any).speaker.trim().length > 0) {
    return (segment as any).speaker.trim();
  }

  if (
    typeof (segment as any).speaker_label === 'string' &&
    (segment as any).speaker_label.trim().length > 0
  ) {
    return (segment as any).speaker_label.trim();
  }

  return undefined;
}

function findTopicForSegment(
  segment: TranscriptSegment,
  topics: Topic[] | undefined
): string | undefined {
  if (!topics?.length) {
    return undefined;
  }

  const start = segment.start;
  const end = segment.start + segment.duration;

  for (const topic of topics) {
    const overlaps = topic.segments.some((segmentRange) => {
      const overlapStart = Math.max(start, segmentRange.start);
      const overlapEnd = Math.min(end, segmentRange.end);
      return overlapEnd - overlapStart > Math.min(segment.duration, segmentRange.end - segmentRange.start) * 0.3;
    });

    if (overlaps) {
      return topic.title ?? undefined;
    }
  }

  return undefined;
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function generateTxtContent(
  transcript: TranscriptSegment[],
  options: TranscriptExportOptions,
  hasSpeakerLabels: boolean
): string {
  const lines: string[] = [];

  if (options.videoTitle) {
    lines.push(options.videoTitle.trim());
  }
  if (options.videoAuthor) {
    lines.push(`by ${options.videoAuthor.trim()}`);
  }
  if (lines.length > 0) {
    lines.push('');
  }

  for (const segment of transcript) {
    const timeLabel = options.includeTimestamps
      ? `[${formatClockTime(segment.start)}] `
      : '';
    const speakerLabel =
      options.includeSpeakers && hasSpeakerLabels
        ? (() => {
            const speaker = getSegmentSpeaker(segment);
            return speaker ? `${speaker}: ` : '';
          })()
        : '';

    const text = sanitizeText(segment.text ?? '');
    if (!text) continue;

    lines.push(`${timeLabel}${speakerLabel}${text}`);
  }

  return lines.join('\n');
}

function generateSrtContent(
  transcript: TranscriptSegment[],
  options: TranscriptExportOptions,
  hasSpeakerLabels: boolean
): string {
  return transcript
    .map((segment, index) => {
      const start = formatSrtTimestamp(segment.start);
      const end = formatSrtTimestamp(segment.start + segment.duration);
      const speaker =
        options.includeSpeakers && hasSpeakerLabels ? getSegmentSpeaker(segment) : undefined;
      const text = sanitizeText(segment.text ?? '');

      if (!text) {
        return null;
      }

      const lines = [
        `${index + 1}`,
        `${start} --> ${end}`,
        speaker ? `${speaker}: ${text}` : text,
      ];

      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function escapeCsvValue(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ').trim();
  if (normalized === '') {
    return '';
  }

  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
}

function generateCsvContent(
  transcript: TranscriptSegment[],
  options: TranscriptExportOptions,
  hasSpeakerLabels: boolean
): string {
  const rows: string[] = [];

  const includeTimestamps = Boolean(options.includeTimestamps);
  const includeSpeakers = Boolean(options.includeSpeakers && hasSpeakerLabels);
  const includeTopics = Boolean(options.topics && options.topics.length > 0);

  const header: string[] = [];
  if (includeTimestamps) {
    header.push('start_time', 'end_time');
  }
  if (includeSpeakers) {
    header.push('speaker');
  }
  header.push('text');
  if (includeTopics) {
    header.push('topic');
  }
  rows.push(header.join(','));

  for (const segment of transcript) {
    const text = sanitizeText(segment.text ?? '');
    if (!text) continue;

    const values: string[] = [];
    if (includeTimestamps) {
      values.push(formatClockTime(segment.start), formatClockTime(segment.start + segment.duration));
    }
    if (includeSpeakers) {
      values.push(getSegmentSpeaker(segment) ?? '');
    }
    values.push(escapeCsvValue(text));

    if (includeTopics) {
      const topicTitle = findTopicForSegment(segment, options.topics);
      values.push(topicTitle ? escapeCsvValue(topicTitle) : '');
    }

    rows.push(values.join(','));
  }

  return rows.join('\n');
}

export function createTranscriptExport(
  transcript: TranscriptSegment[],
  options: TranscriptExportOptions
): TranscriptExportResult {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new Error('Transcript is empty.');
  }

  const hasSpeakerLabels = transcript.some((segment) => Boolean(getSegmentSpeaker(segment)));
  const normalizedOptions: TranscriptExportOptions = {
    ...options,
    includeSpeakers: options.includeSpeakers && hasSpeakerLabels,
  };

  let content: string;
  let extension: string;
  let mimeType: string;

  switch (options.format) {
    case 'srt':
      content = generateSrtContent(transcript, normalizedOptions, hasSpeakerLabels);
      extension = 'srt';
      mimeType = 'text/plain;charset=utf-8';
      break;
    case 'csv':
      content = generateCsvContent(transcript, normalizedOptions, hasSpeakerLabels);
      extension = 'csv';
      mimeType = 'text/csv;charset=utf-8';
      break;
    case 'txt':
    default:
      content = generateTxtContent(transcript, normalizedOptions, hasSpeakerLabels);
      extension = 'txt';
      mimeType = 'text/plain;charset=utf-8';
  }

  const filenameParts = [DEFAULT_FILENAME];
  if (options.videoTitle) {
    filenameParts.push(
      options.videoTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
    );
  }

  const filename = `${filenameParts.join('-') || DEFAULT_FILENAME}.${extension}`;
  const blob = new Blob([content], { type: mimeType });

  return { blob, filename };
}

export function hasSpeakerMetadata(transcript: TranscriptSegment[]): boolean {
  return transcript.some((segment) => Boolean(getSegmentSpeaker(segment)));
}

