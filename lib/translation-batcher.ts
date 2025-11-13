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
  private readonly maxRetries: number;
  private readonly batchThrottleMs: number;
  private readonly onError?: (error: Error, isRateLimitError: boolean) => void;

  constructor(
    batchDelay: number = 20,
    maxBatchSize: number = 1000,
    cache: Map<string, string>,
    maxRetries: number = 3,
    batchThrottleMs: number = 200,
    onError?: (error: Error, isRateLimitError: boolean) => void
  ) {
    if (maxBatchSize < 1 || maxBatchSize > 10000) {
      throw new Error('maxBatchSize must be between 1 and 10000');
    }

    this.batchDelay = batchDelay;
    this.maxBatchSize = maxBatchSize;
    this.cache = cache;
    this.maxRetries = maxRetries;
    this.batchThrottleMs = batchThrottleMs;
    this.onError = onError;
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
      return cached;
    }

    // Add to queue and return a promise
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ text, cacheKey, targetLanguage, resolve, reject });

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
      this.processNextBatch();
      return;
    }

    // If we're already processing, do nothing - it will drain the queue
    if (this.processing) {
      return;
    }

    // Otherwise, schedule a batch if not already scheduled
    if (!this.scheduledTimeout) {
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
        return;
      }

      // Execute the batch (all the business logic)
      await this.executeBatch(batch);
    } catch (error) {
      console.error('[Translation] Unexpected error in batch processing:', error);
    } finally {
      // Always release the lock
      this.processing = false;

      // If there are more items, schedule next batch
      if (this.queue.length > 0) {
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

    // Process each language group with throttling between groups
    let isFirst = true;
    for (const [targetLanguage, requests] of byLanguage.entries()) {
      // Add throttle delay between batches (except for the first one)
      if (!isFirst && this.batchThrottleMs > 0) {
        await this.sleep(this.batchThrottleMs);
      }
      isFirst = false;

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
   * Sleep helper for retry logic
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay
   */
  private getBackoffDelay(attempt: number, retryAfter?: number): number {
    // If server provides Retry-After, use it
    if (retryAfter) {
      return retryAfter * 1000; // Convert seconds to milliseconds
    }
    // Otherwise use exponential backoff: 1s, 2s, 4s, 8s...
    return Math.min(1000 * Math.pow(2, attempt), 10000); // Cap at 10 seconds
  }

  /**
   * Translate a group of requests for a single language
   */
  private async translateLanguageGroup(
    targetLanguage: string,
    requests: TranslationRequest[]
  ): Promise<void> {
    // Get unique texts (avoid translating duplicates)
    const uniqueTexts = Array.from(new Set(requests.map((r) => r.text)));

    let lastError: Error | null = null;

    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
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
          // Handle rate limiting with retry
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;

            // If we haven't exceeded max retries, wait and retry
            if (attempt < this.maxRetries) {
              const delay = this.getBackoffDelay(attempt, retryAfterSeconds);
              console.warn(
                `[Translation] Rate limited (429). Retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`
              );
              await this.sleep(delay);
              continue; // Retry
            }

            // Max retries exceeded
            throw new Error(`Translation API rate limit exceeded after ${this.maxRetries} retries`);
          }

          // For other errors, throw immediately
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

          // Resolve the promise
          request.resolve(translation);
        }

        // Success! Exit retry loop
        return;
      } catch (error) {
        lastError = error as Error;

        // If this is the last attempt, don't retry
        if (attempt === this.maxRetries) {
          break;
        }

        // For non-429 errors, log and exit retry loop
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage?.includes('429') && !errorMessage?.includes('rate limit')) {
          console.error('[Translation] API error (non-retryable):', error);
          break;
        }
      }
    }

    // If we get here, all retries failed
    console.error('[Translation] Failed to translate batch after retries:', lastError);

    // Notify error handler if provided
    if (lastError && this.onError) {
      const isRateLimitError = lastError.message?.includes('429') || lastError.message?.includes('rate limit');
      this.onError(lastError, isRateLimitError);
    }

    // On error, resolve with original text
    for (const request of requests) {
      request.resolve(request.text);
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
