export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface Topic {
  id: string;
  title: string;
  description?: string;
  duration: number;
  segments: {
    start: number;
    end: number;
    text: string;
    startSegmentIdx?: number;
    endSegmentIdx?: number;
    // Character offsets within the start/end segments for precise highlighting
    startCharOffset?: number;
    endCharOffset?: number;
    // Whether the text includes complete sentences
    hasCompleteSentences?: boolean;
  }[];
  keywords?: string[]; // Optional for backward compatibility
  quote?: {
    timestamp: string;
    text: string;
  };
  isCitationReel?: boolean; // Flag to identify citation playback reels
  autoPlay?: boolean; // Flag to indicate auto-play when topic is selected
}

export interface TopicCandidate {
  key: string;
  title: string;
  quote: {
    timestamp: string;
    text: string;
  };
}

export type TopicGenerationMode = 'smart' | 'fast';

export interface VideoData {
  videoId: string;
  title: string;
  transcript: TranscriptSegment[];
  topics: Topic[];
}

export interface Citation {
  number: number;
  text: string;
  start: number;
  end: number;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  timestamp: Date;
}

export type NoteSource = 'chat' | 'takeaways' | 'transcript' | 'custom';

export interface NoteMetadata {
  transcript?: {
    start: number;
    end?: number;
    segmentIndex?: number;
    topicId?: string;
  };
  chat?: {
    messageId: string;
    role: 'user' | 'assistant';
    timestamp?: string;
  };
  selectedText?: string;
  selectionContext?: string;
  timestampLabel?: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Note {
  id: string;
  userId: string;
  videoId: string;
  source: NoteSource;
  sourceId?: string | null;
  text: string;
  metadata?: NoteMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteWithVideo extends Note {
  video: {
    youtubeId: string;
    title: string;
    author: string;
    thumbnailUrl: string;
    duration: number;
  } | null;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number | null;
  description?: string;
  tags?: string[];
}

// Playback command types for centralized control
export type PlaybackCommandType = 'SEEK' | 'PLAY_TOPIC' | 'PLAY_SEGMENT' | 'PLAY' | 'PAUSE' | 'PLAY_ALL' | 'PLAY_CITATIONS';

export interface PlaybackCommand {
  type: PlaybackCommandType;
  time?: number;
  topic?: Topic;
  segment?: TranscriptSegment;
  citations?: Citation[];
  autoPlay?: boolean;
}