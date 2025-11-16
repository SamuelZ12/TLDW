import { LLMTranslateClient } from './llm-translate-client';
import type { TranslationProvider } from './types';

let translationClient: TranslationProvider | null = null;

/**
 * Get or create the singleton LLM translation client
 *
 * Environment variables:
 * - TRANSLATION_LLM_TEMPERATURE: Optional, default 0.3
 * - Uses current AI_PROVIDER (Gemini/Grok) from ai-client
 */
export function getTranslationClient(): TranslationProvider {
  if (!translationClient) {
    const temperature = process.env.TRANSLATION_LLM_TEMPERATURE
      ? parseFloat(process.env.TRANSLATION_LLM_TEMPERATURE)
      : undefined;

    translationClient = new LLMTranslateClient({ temperature });
    console.log(
      `[TRANSLATION] LLM client initialized (temperature: ${temperature ?? 0.3}, ` +
      `inherits AI_PROVIDER from ai-client)`
    );
  }

  return translationClient;
}