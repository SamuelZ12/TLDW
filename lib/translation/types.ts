export interface TranslationContext {
  videoTitle?: string;
  videoDescription?: string;
  videoTags?: string[];
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
