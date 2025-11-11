/**
 * Translation Batcher - Clean, maintainable implementation
 *
 * Design principles:
 * 1. Single responsibility per method
 * 2. Clear state machine (IDLE -> PROCESSING -> IDLE)
 * 3. No re-queuing - process sequentially until queue empty
 * 4. Fail-safe - always drain queue eventually
 */

interface TranslationRequest {
  text: string;
  cacheKey: string;
  targetLanguage: string;
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
}

export class TranslationBatcher {
  // State
  private queue: TranslationRequest[] = [];
  private processing = false;
  private scheduledTimeout: NodeJS.Timeout | null = null;

  // Configuration
  private readonly batchDelay: number;
  private readonly maxBatchSize: number;
  private readonly cache: Map<string, string>;

  constructor(
    batchDelay: number = 50,
    maxBatchSize: number = 100,
    cache: Map<string, string>
  ) {
    if (maxBatchSize < 1 || maxBatchSize > 100) {
      throw new Error('maxBatchSize must be between 1 and 100');
    }

    this.batchDelay = batchDelay;
    this.maxBatchSize = maxBatchSize;
    this.cache = cache;
  }

  /**
   * Request a translation - will be automatically batched
   */
  async translate(
    text: string,
    cacheKey: string,
    targetLanguage: string
  ): Promise<string> {
    // Check cache first (synchronous, fast)
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      console.log(`[BATCHER] 🎯 Cache hit: "${cacheKey}"`);
      return cached;
    }

    console.log(`[BATCHER] ❌ Cache miss: "${cacheKey}" - queuing`);

    // Add to queue and return a promise
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ text, cacheKey, targetLanguage, resolve, reject });
      console.log(
        `[BATCHER] Queue size: ${this.queue.length}/${this.maxBatchSize}`
      );

      // Trigger batch processing if needed
      this.maybeStartBatch();
    });
  }

  /**
   * Decide whether to process batch now or schedule it
   * Simple logic: full queue = immediate, otherwise schedule
   */
  private maybeStartBatch(): void {
    // If queue is full and we're not processing, start immediately
    if (this.queue.length >= this.maxBatchSize && !this.processing) {
      console.log(`[BATCHER] Queue full, processing immediately`);
      this.processNextBatch();
      return;
    }

    // If we're already processing, do nothing - it will drain the queue
    if (this.processing) {
      console.log(
        `[BATCHER] Already processing, current batch will handle queued items`
      );
      return;
    }

    // Otherwise, schedule a batch if not already scheduled
    if (!this.scheduledTimeout) {
      console.log(`[BATCHER] Scheduling batch in ${this.batchDelay}ms`);
      this.scheduledTimeout = setTimeout(() => {
        this.scheduledTimeout = null;
        this.processNextBatch();
      }, this.batchDelay);
    }
  }

  /**
   * Process the next batch from the queue
   * Protected from concurrent execution by this.processing flag
   */
  private async processNextBatch(): Promise<void> {
    // Guard: prevent concurrent processing
    if (this.processing) {
      console.log(`[BATCHER] Already processing, skipping`);
      return;
    }

    // Mark as processing
    this.processing = true;

    try {
      // Clear any scheduled timeout
      if (this.scheduledTimeout) {
        clearTimeout(this.scheduledTimeout);
        this.scheduledTimeout = null;
      }

      // Extract batch from queue (synchronous)
      const batch = this.queue.splice(0, this.maxBatchSize);

      // Nothing to process
      if (batch.length === 0) {
        console.log(`[BATCHER] Queue empty, nothing to process`);
        return;
      }

      console.log(
        `[BATCHER] 🔄 Processing batch of ${batch.length} (${this.queue.length} remaining in queue)`
      );

      // Execute the batch (all the business logic)
      await this.executeBatch(batch);

      console.log(`[BATCHER] ✅ Batch completed`);
    } catch (error) {
      console.error(
        `[BATCHER] ❌ Unexpected error in processNextBatch:`,
        error
      );
    } finally {
      // Always release the lock
      this.processing = false;

      // If there are more items, schedule next batch
      if (this.queue.length > 0) {
        console.log(
          `[BATCHER] ${this.queue.length} items remaining, scheduling next batch`
        );
        setTimeout(() => this.processNextBatch(), 0);
      }
    }
  }

  /**
   * Execute a batch - the actual business logic
   * Separated from orchestration logic for clarity
   */
  private async executeBatch(batch: TranslationRequest[]): Promise<void> {
    // Group requests by target language
    const byLanguage = this.groupByLanguage(batch);

    console.log(`[BATCHER] Batch contains ${byLanguage.size} language(s)`);

    // Process each language group
    for (const [targetLanguage, requests] of byLanguage.entries()) {
      await this.translateLanguageGroup(targetLanguage, requests);
    }
  }

  /**
   * Group requests by target language
   */
  private groupByLanguage(
    batch: TranslationRequest[]
  ): Map<string, TranslationRequest[]> {
    const grouped = new Map<string, TranslationRequest[]>();

    for (const request of batch) {
      const existing = grouped.get(request.targetLanguage) || [];
      existing.push(request);
      grouped.set(request.targetLanguage, existing);
    }

    return grouped;
  }

  /**
   * Translate a group of requests for a single language
   */
  private async translateLanguageGroup(
    targetLanguage: string,
    requests: TranslationRequest[]
  ): Promise<void> {
    console.log(
      `[BATCHER] Translating ${requests.length} items to ${targetLanguage}`
    );

    try {
      // Get unique texts (avoid translating duplicates)
      const uniqueTexts = Array.from(new Set(requests.map((r) => r.text)));

      // Make API call
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: uniqueTexts,
          targetLanguage: targetLanguage
        })
      });

      if (!response.ok) {
        throw new Error(`Translation API error: ${response.status}`);
      }

      const data = await response.json();
      const translations: string[] = data.translations;

      // Map texts to translations
      const translationMap = new Map<string, string>();
      uniqueTexts.forEach((text, index) => {
        translationMap.set(text, translations[index] || text);
      });

      // Resolve all requests and cache results
      for (const request of requests) {
        const translation = translationMap.get(request.text) || request.text;

        // Cache it
        this.cache.set(request.cacheKey, translation);
        console.log(`[BATCHER] 💾 Cached: "${request.cacheKey}"`);

        // Resolve the promise
        request.resolve(translation);
      }

      console.log(
        `[BATCHER] ✅ ${targetLanguage} group completed. Cache size: ${this.cache.size}`
      );
    } catch (error) {
      console.error(
        `[BATCHER] ❌ Failed to translate ${targetLanguage} group:`,
        error
      );

      // On error, resolve with original text
      for (const request of requests) {
        console.log(
          `[BATCHER] Fallback to original: "${request.text.substring(
            0,
            30
          )}..."`
        );
        request.resolve(request.text);
      }
    }
  }

  /**
   * Clear pending requests (cache is preserved)
   */
  clear(): void {
    if (this.scheduledTimeout) {
      clearTimeout(this.scheduledTimeout);
      this.scheduledTimeout = null;
    }

    console.log(`[BATCHER] Clearing ${this.queue.length} pending requests`);
    this.queue = [];
  }

  /**
   * Clear pending requests (alias for backward compatibility)
   */
  clearPending(): void {
    this.clear();
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      cacheSize: this.cache.size,
      scheduled: this.scheduledTimeout !== null
    };
  }
}
