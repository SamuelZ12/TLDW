import { useState, useCallback, useRef } from 'react';
import { TranslationBatcher } from '@/lib/translation-batcher';
import type { TranslationContext, TranslationScenario } from '@/lib/translation/llm-translate-client';
import type { VideoInfo } from '@/lib/types';
import { toast } from 'sonner';

export function useTranslation() {
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [translationCache, setTranslationCache] = useState<Map<string, string>>(new Map());
  const translationBatcherRef = useRef<TranslationBatcher | null>(null);
  const errorShownRef = useRef(false);

  const handleRequestTranslation = useCallback(async (
    text: string,
    cacheKey: string,
    scenario?: TranslationScenario,
    videoInfo?: VideoInfo | null
  ): Promise<string> => {
    if (!selectedLanguage) return text;

    if (!translationBatcherRef.current) {
      translationBatcherRef.current = new TranslationBatcher(
        20, // batchDelay: collect quickly but allow coalescing
        1000, // maxBatchSize: larger single request per language
        translationCache,
        3, // maxRetries
        0, // batchThrottleMs: no delay between same-language groups
        (error: Error, isRateLimitError: boolean) => {
          // Only show one error toast per batch to avoid spam
          if (errorShownRef.current) return;
          errorShownRef.current = true;

          if (isRateLimitError) {
            toast.error('Translation rate limit exceeded', {
              description: 'Please wait a moment and try again. Some translations may not be available.',
              duration: 5000,
            });
          } else {
            toast.error('Translation failed', {
              description: 'Unable to translate content. Showing original text.',
              duration: 4000,
            });
          }

          // Reset error flag after a delay to allow new errors to be shown
          setTimeout(() => {
            errorShownRef.current = false;
          }, 10000);
        }
      );
    }

    // Build translation context from video info
    const context: TranslationContext | undefined = scenario ? {
      scenario,
      videoTitle: videoInfo?.title ?? undefined,
      topicKeywords: Array.isArray(videoInfo?.tags) && videoInfo.tags.length > 0
        ? videoInfo.tags
        : undefined,
    } : undefined;

    const translation = await translationBatcherRef.current.translate(
      text,
      cacheKey,
      selectedLanguage,
      context
    );

    const MAX_CACHE_SIZE = 500;
    if (translationCache.size >= MAX_CACHE_SIZE && !translationCache.has(cacheKey)) {
      const firstKey = translationCache.keys().next().value;
      if (firstKey !== undefined) {
        translationCache.delete(firstKey);
      }
    }

    return translation;
  }, [translationCache, selectedLanguage]);

  const handleLanguageChange = useCallback((languageCode: string | null) => {
    setSelectedLanguage(languageCode);

    if (translationBatcherRef.current && !languageCode) {
      translationBatcherRef.current.clear();
      translationBatcherRef.current = null;
    } else if (translationBatcherRef.current) {
      translationBatcherRef.current.clearPending();
    }
  }, []);

  return {
    selectedLanguage,
    translationCache,
    handleRequestTranslation,
    handleLanguageChange,
  };
}
