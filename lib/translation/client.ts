import { GoogleTranslateClient } from './google-translate-client';
import type { TranslationProvider } from './types';

let translationClient: TranslationProvider | null = null;

export function getTranslationClient(): TranslationProvider {
  if (!translationClient) {
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