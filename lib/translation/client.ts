import { GoogleTranslateClient } from './google-translate-client';
import { MockTranslateClient } from './mock-translate-client';
import { LLMTranslateClient } from './llm-translate-client';
import type { TranslationProvider } from './types';

let translationClient: TranslationProvider | null = null;

type TranslationProviderType = 'google' | 'llm' | 'mock';

/**
 * Get or create the singleton translation client based on environment configuration
 *
 * Provider selection (in order of precedence):
 * 1. NEXT_PUBLIC_USE_MOCK_TRANSLATION=true → Mock client (for testing)
 * 2. TRANSLATION_PROVIDER env var → 'google' | 'llm' | 'mock'
 * 3. Error if no provider is configured
 *
 * Environment variables:
 * - TRANSLATION_PROVIDER: Required (unless using mock). Values: 'google', 'llm', 'mock'
 * - GOOGLE_TRANSLATE_API_KEY: Required when TRANSLATION_PROVIDER='google'
 * - TRANSLATION_LLM_TEMPERATURE: Optional, default 0.3 (when using 'llm')
 * - For LLM provider: Uses current AI_PROVIDER (Gemini/Grok) from ai-client
 */
export function getTranslationClient(): TranslationProvider {
  if (!translationClient) {
    // Legacy: Use mock translation for local development when enabled
    const useMockTranslation = process.env.NEXT_PUBLIC_USE_MOCK_TRANSLATION === 'true';

    if (useMockTranslation) {
      console.log('[TRANSLATION] Using mock translation client (NEXT_PUBLIC_USE_MOCK_TRANSLATION=true)');
      translationClient = new MockTranslateClient();
      return translationClient;
    }

    // Get provider from environment variable
    const provider = process.env.TRANSLATION_PROVIDER as TranslationProviderType | undefined;

    if (!provider) {
      throw new Error(
        'TRANSLATION_PROVIDER environment variable is required. ' +
        'Set to "google", "llm", or "mock".'
      );
    }

    console.log(`[TRANSLATION] Initializing ${provider} translation provider`);

    switch (provider) {
      case 'google': {
        const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
        if (!apiKey) {
          throw new Error(
            'GOOGLE_TRANSLATE_API_KEY environment variable is required when TRANSLATION_PROVIDER=google'
          );
        }
        translationClient = new GoogleTranslateClient(apiKey);
        break;
      }

      case 'llm': {
        const temperature = process.env.TRANSLATION_LLM_TEMPERATURE
          ? parseFloat(process.env.TRANSLATION_LLM_TEMPERATURE)
          : undefined;

        translationClient = new LLMTranslateClient({ temperature });
        console.log(
          `[TRANSLATION] LLM client initialized (temperature: ${temperature ?? 0.3}, ` +
          `inherits AI_PROVIDER from ai-client)`
        );
        break;
      }

      case 'mock': {
        translationClient = new MockTranslateClient();
        break;
      }

      default: {
        throw new Error(
          `Invalid TRANSLATION_PROVIDER: "${provider}". Must be "google", "llm", or "mock".`
        );
      }
    }
  }

  return translationClient;
}

/**
 * Create a new Google Translate client (legacy, for backward compatibility)
 * @deprecated Use getTranslationClient() instead
 */
export function createTranslationClient(apiKey: string): TranslationProvider {
  return new GoogleTranslateClient(apiKey);
}

/**
 * Reset the singleton client (useful for testing)
 * @internal
 */
export function resetTranslationClient(): void {
  translationClient = null;
}