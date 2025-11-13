import { GoogleTranslateClient } from './google-translate-client';
import { MockTranslateClient } from './mock-translate-client';
import type { TranslationProvider } from './types';

let translationClient: TranslationProvider | null = null;

export function getTranslationClient(): TranslationProvider {
  if (!translationClient) {
    // Use mock translation for local development when enabled
    const useMockTranslation = process.env.NEXT_PUBLIC_USE_MOCK_TRANSLATION === 'true';

    if (useMockTranslation) {
      console.log('[TRANSLATION] Using mock translation client (NEXT_PUBLIC_USE_MOCK_TRANSLATION=true)');
      translationClient = new MockTranslateClient();
      return translationClient;
    }

    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;

    if (!apiKey) {
      throw new Error('GOOGLE_TRANSLATE_API_KEY environment variable is required');
    }

    translationClient = new GoogleTranslateClient(apiKey);
  }

  return translationClient;
}

export function createTranslationClient(apiKey: string): TranslationProvider {
  return new GoogleTranslateClient(apiKey);
}