import type { TranslationProvider } from './types';

/**
 * Mock translation client for local development
 * Returns a simple transformation instead of calling real translation API
 */
export class MockTranslateClient implements TranslationProvider {
  async translate(text: string, targetLanguage: string): Promise<string> {
    if (!text || text.trim() === '') {
      return text;
    }

    // For development, just return the original text with a prefix
    // In a real scenario, you might want to use a simple dictionary or leave as-is
    return `[${targetLanguage.toUpperCase()}] ${text}`;
  }

  async translateBatch(texts: string[], targetLanguage: string): Promise<string[]> {
    // Return all texts with prefix
    return texts.map(text => {
      if (!text || text.trim() === '') {
        return text;
      }
      return `[${targetLanguage.toUpperCase()}] ${text}`;
    });
  }
}
