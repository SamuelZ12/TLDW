import type { TranslationProvider } from './types';

/**
 * Mock translation client for local development
 * Returns a simple transformation instead of calling real translation API
 */
export class MockTranslateClient implements TranslationProvider {
  async translateBatch(
    texts: string[],
    targetLanguage: string
  ): Promise<string[]> {
    // Return all texts with prefix
    return texts.map((text) => {
      if (!text || text.trim() === '') {
        return text;
      }
      return `[${targetLanguage.toUpperCase()}] ${text}`;
    });
  }
}
