/**
 * Translation Batcher - Batches multiple translation requests into a single API call
 * Reduces API calls from N individual requests to 1 batch request
 */

interface TranslationRequest {
  text: string;
  cacheKey: string;
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
}

export class TranslationBatcher {
  private queue: TranslationRequest[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly batchDelay: number;
  private readonly maxBatchSize: number;
  private cache: Map<string, string>;
  private readonly targetLanguage: string;

  constructor(
    batchDelay: number = 50, // Wait 50ms to collect requests
    maxBatchSize: number = 100,
    cache: Map<string, string>,
    targetLanguage: string = 'zh-CN'
  ) {
    this.batchDelay = batchDelay;
    this.maxBatchSize = maxBatchSize;
    this.cache = cache;
    this.targetLanguage = targetLanguage;
  }

  /**
   * Request a translation - will be automatically batched
   */
  async translate(text: string, cacheKey: string): Promise<string> {
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    return new Promise<string>((resolve, reject) => {
      // Add to queue
      this.queue.push({ text, cacheKey, resolve, reject });

      // If we hit max batch size, process immediately
      if (this.queue.length >= this.maxBatchSize) {
        this.processBatch();
        return;
      }

      // Otherwise, schedule batch processing
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => {
          this.processBatch();
        }, this.batchDelay);
      }
    });
  }

  /**
   * Process all queued translation requests as a batch
   */
  private async processBatch() {
    // Clear timeout if exists
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    // Take all pending requests
    const batch = this.queue.splice(0, this.maxBatchSize);
    if (batch.length === 0) return;

    console.log(`[TRANSLATION-BATCHER] Processing batch of ${batch.length} translations`);

    try {
      // Extract unique texts to translate (avoid duplicates in same batch)
      const uniqueTexts = Array.from(new Set(batch.map(req => req.text)));

      // Make batched API call
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: uniqueTexts,
          targetLanguage: this.targetLanguage
        }),
      });

      if (!response.ok) {
        throw new Error(`Translation API error: ${response.status}`);
      }

      const data = await response.json();
      const translations: string[] = data.translations;

      // Create a map of text -> translation
      const translationMap = new Map<string, string>();
      uniqueTexts.forEach((text, index) => {
        const translation = translations[index] || text;
        translationMap.set(text, translation);
      });

      // Update cache and resolve all requests
      batch.forEach(req => {
        const translation = translationMap.get(req.text) || req.text;

        // Cache the result
        this.cache.set(req.cacheKey, translation);

        // Resolve the promise
        req.resolve(translation);
      });

      console.log(`[TRANSLATION-BATCHER] Batch completed successfully`);
    } catch (error) {
      console.error('[TRANSLATION-BATCHER] Batch failed:', error);

      // Reject all requests in the batch
      batch.forEach(req => {
        // On error, return original text
        req.resolve(req.text);
      });
    }

    // If there are still items in queue, process next batch
    if (this.queue.length > 0) {
      setTimeout(() => this.processBatch(), 0);
    }
  }

  /**
   * Clear any pending batches
   */
  clear() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.queue = [];
  }

  /**
   * Get current batch size
   */
  getPendingCount(): number {
    return this.queue.length;
  }
}
