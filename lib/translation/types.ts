export type TranslationScenario = 'transcript' | 'chat' | 'topic' | 'general';

export interface TranslationContext {
  scenario?: TranslationScenario;
  videoTitle?: string;
  videoDescription?: string;
  videoTags?: string[];
  topicKeywords?: string[];
  preserveFormatting?: boolean;
}

export interface TranslationProvider {
  translate(text: string, targetLanguage: string): Promise<string>;
  translateBatch(texts: string[], targetLanguage: string, context?: TranslationContext): Promise<string[]>;
}

export interface TranslationResult {
  original: string;
  translated: string;
  language: string;
}

export interface TranslationError extends Error {
  code?: string;
  details?: unknown;
}
