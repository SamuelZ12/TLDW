export interface TranslationProvider {
  translate(text: string, targetLanguage: string): Promise<string>;
  translateBatch(texts: string[], targetLanguage: string): Promise<string[]>;
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
