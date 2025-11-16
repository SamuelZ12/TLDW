import { GoogleTranslateClient } from './google-translate-client';
import { MockTranslateClient } from './mock-translate-client';
import { LLMTranslateClient } from './llm-translate-client';
import type { TranslationProvider } from './types';

let translationClient: TranslationProvider | null = null;

type TranslationProviderType = 'google' | 'llm' | 'mock';

/**
 * Get or create the singleton translation client based on environment configuration
 *
 * Environment variables:
 * - TRANSLATION_PROVIDER: Required. Values: 'google', 'llm', 'mock'
 * - GOOGLE_TRANSLATE_API_KEY: Required when TRANSLATION_PROVIDER='google'
 * - TRANSLATION_LLM_TEMPERATURE: Optional, default 0.3 (when using 'llm')
 * - For LLM provider: Uses current AI_PROVIDER (Gemini/Grok) from ai-client
 */
export function getTranslationClient(): TranslationProvider {
  if (!translationClient) {
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