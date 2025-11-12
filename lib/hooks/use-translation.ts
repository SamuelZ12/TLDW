import { useState, useCallback, useRef } from 'react';
import { TranslationBatcher } from '@/lib/translation-batcher';

export function useTranslation() {
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [translationCache, setTranslationCache] = useState<Map<string, string>>(new Map());
  const translationBatcherRef = useRef<TranslationBatcher | null>(null);

  const handleRequestTranslation = useCallback(async (text: string, cacheKey: string): Promise<string> => {
    if (!selectedLanguage) return text;

    if (!translationBatcherRef.current) {
      console.log(`[Translation] Initializing TranslationBatcher (language-agnostic), cache ref:`, translationCache);
      translationBatcherRef.current = new TranslationBatcher(
        50,
        100,
        translationCache
      );
    }

    const translation = await translationBatcherRef.current.translate(text, cacheKey, selectedLanguage);

    const MAX_CACHE_SIZE = 500;
    if (translationCache.size >= MAX_CACHE_SIZE && !translationCache.has(cacheKey)) {
      const firstKey = translationCache.keys().next().value;
      if (firstKey !== undefined) {
        console.log(`[Translation] Cache full (${translationCache.size}), evicting oldest entry: ${firstKey}`);
        translationCache.delete(firstKey);
      }
    }

    return translation;
  }, [translationCache, selectedLanguage]);

  const handleLanguageChange = useCallback((languageCode: string | null) => {
    console.log(`[Translation] Language changed to: ${languageCode}`);
    setSelectedLanguage(languageCode);

    if (translationBatcherRef.current && !languageCode) {
      console.log(`[Translation] Clearing batcher (switching to English)`);
      translationBatcherRef.current.clear();
      translationBatcherRef.current = null;
    } else if (translationBatcherRef.current) {
      console.log(`[Translation] Clearing pending requests for language switch`);
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
