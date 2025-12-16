import { useState, useCallback, useRef } from 'react';
import { TranslationBatcher } from '@/lib/translation-batcher';
import type { TranslationContext, TranslationScenario } from '@/lib/translation/types';
import type { VideoInfo } from '@/lib/types';
import { toast } from 'sonner';

export type BulkTranslationHandler = (
  items: Array<{ index: number; text: string }>,
  targetLanguage: string,
  scenario: TranslationScenario,
  videoInfo?: VideoInfo | null,
  onProgress?: (completed: number, total: number) => void
) => Promise<Map<number, string>>;

export function useTranslation() {
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [translationCache, setTranslationCache] = useState<Map<string, string>>(new Map());
  const translationBatcherRef = useRef<TranslationBatcher | null>(null);
  const errorShownRef = useRef(false);

  const handleRequestTranslation = useCallback(async (
    text: string,
    cacheKey: string,
    scenario?: TranslationScenario,
    videoInfo?: VideoInfo | null,
    targetLanguage?: string
  ): Promise<string> => {
    // Use explicit targetLanguage if provided, otherwise fall back to selectedLanguage state
    const langToUse = targetLanguage ?? selectedLanguage;
    if (!langToUse) return text;

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
      langToUse,
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

  /**
   * Bulk translation for export - uses chunked parallel API calls for real-time progress
   * Splits items into chunks and fires multiple parallel requests, updating progress as each completes
   */
  const handleBulkTranslation: BulkTranslationHandler = useCallback(async (
    items,
    targetLanguage,
    scenario,
    videoInfo,
    onProgress
  ) => {
    const results = new Map<number, string>();

    if (items.length === 0) {
      return results;
    }

    // 1. Check cache first for all items
    const uncached: Array<{ index: number; text: string }> = [];
    for (const item of items) {
      const cacheKey = `transcript:${item.index}:${targetLanguage}`;
      if (translationCache.has(cacheKey)) {
        results.set(item.index, translationCache.get(cacheKey)!);
      } else {
        uncached.push(item);
      }
    }

    // Report initial cached progress
    if (onProgress) {
      onProgress(results.size, items.length);
    }

    // All items were cached
    if (uncached.length === 0) {
      return results;
    }

    // 2. Split into chunks for parallel processing with real progress updates
    const CHUNK_SIZE = 100; // Match API's internal chunk size for optimal performance
    const chunks: Array<Array<{ index: number; text: string }>> = [];
    for (let i = 0; i < uncached.length; i += CHUNK_SIZE) {
      chunks.push(uncached.slice(i, i + CHUNK_SIZE));
    }

    const context: TranslationContext = {
      scenario,
      videoTitle: videoInfo?.title ?? undefined,
      topicKeywords: Array.isArray(videoInfo?.tags) && videoInfo.tags.length > 0
        ? videoInfo.tags
        : undefined,
    };

    // 3. Process all chunks in parallel with progress updates as each completes
    // Use a ref-like pattern to track completed count across async callbacks
    let completedCount = results.size;

    const chunkPromises = chunks.map(async (chunk) => {
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            texts: chunk.map(item => item.text),
            targetLanguage,
            context,
          }),
        });

        if (!response.ok) {
          throw new Error(`Translation API error: ${response.status}`);
        }

        const data = await response.json();
        const translations: string[] = data.translations;

        // Store results and update cache
        for (let i = 0; i < chunk.length; i++) {
          const { index, text } = chunk[i];
          const translation = translations[i] ?? text;
          const cacheKey = `transcript:${index}:${targetLanguage}`;
          translationCache.set(cacheKey, translation);
          results.set(index, translation);
        }

        // Update progress after this chunk completes
        completedCount += chunk.length;
        if (onProgress) {
          onProgress(completedCount, items.length);
        }
      } catch (error) {
        console.error('[Bulk Translation] Chunk error:', error);
        // Fallback to original text for this chunk
        for (const item of chunk) {
          if (!results.has(item.index)) {
            results.set(item.index, item.text);
          }
        }
        // Still update progress so it doesn't get stuck
        completedCount += chunk.length;
        if (onProgress) {
          onProgress(completedCount, items.length);
        }
      }
    });

    // Wait for all chunks to complete
    await Promise.all(chunkPromises);

    // Show error toast if any translations failed
    const failedCount = items.length - results.size;
    if (failedCount > 0) {
      toast.error('Translation partially failed', {
        description: `${failedCount} segments could not be translated. Using original text.`,
        duration: 4000,
      });
    }

    return results;
  }, [translationCache]);

  return {
    selectedLanguage,
    translationCache,
    handleRequestTranslation,
    handleBulkTranslation,
    handleLanguageChange,
  };
}
