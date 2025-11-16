import { z } from 'zod';
import { generateAIResponse } from '@/lib/ai-client';
import type { TranslationProvider, TranslationContext, TranslationScenario } from './types';

/**
 * Schema for batch translation responses (JSON format - fallback)
 */
const batchTranslationSchema = z.object({
  translations: z.array(z.string()),
});

/**
 * Delimiter used for line-delimited translation format
 */
const TRANSLATION_DELIMITER = '<<<TRANSLATION>>>';

/**
 * LLM-based translation client that uses AI providers (Gemini/Grok)
 * for context-aware, high-quality translation.
 *
 * Inherits AI provider from current AI_PROVIDER environment variable.
 */
export class LLMTranslateClient implements TranslationProvider {
  private readonly temperature: number;

  constructor(options: { temperature?: number } = {}) {
    // Lower temperature for more consistent translations
    this.temperature = options.temperature ?? 0.3;
  }

  /**
   * Translate a single text
   */
  async translate(
    text: string,
    targetLanguage: string,
    context?: TranslationContext
  ): Promise<string> {
    const results = await this.translateBatch([text], targetLanguage, context);
    return results[0];
  }

  /**
   * Translate multiple texts in an optimized batch
   */
  async translateBatch(
    texts: string[],
    targetLanguage: string,
    context?: TranslationContext
  ): Promise<string[]> {
    if (texts.length === 0) {
      return [];
    }

    // For large batches, split into smaller chunks to improve reliability
    // Reduced from 50 to 25 to prevent JSON truncation and parsing errors
    const MAX_BATCH_SIZE = 25;
    if (texts.length > MAX_BATCH_SIZE) {
      console.log(
        `[LLM Translation] Large batch (${texts.length} items), splitting into chunks of ${MAX_BATCH_SIZE}`
      );
      const chunks: string[][] = [];
      for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
        chunks.push(texts.slice(i, i + MAX_BATCH_SIZE));
      }

      const results = await Promise.all(
        chunks.map((chunk) => this.translateBatchInternal(chunk, targetLanguage, context))
      );

      return results.flat();
    }

    return this.translateBatchInternal(texts, targetLanguage, context);
  }

  /**
   * Internal method to translate a batch with retry logic
   */
  private async translateBatchInternal(
    texts: string[],
    targetLanguage: string,
    context?: TranslationContext,
    attempt: number = 1
  ): Promise<string[]> {
    const MAX_RETRIES = 2;
    const prompt = this.buildLineDelimitedPrompt(texts, targetLanguage, context);

    try {
      const response = await generateAIResponse(prompt, {
        temperature: this.temperature,
        maxOutputTokens: 16384, // Increased from 8192 to prevent truncation
        // Don't use zodSchema for line-delimited format
        metadata: {
          operation: 'translation',
          scenario: context?.scenario ?? 'general',
          targetLanguage,
          textCount: texts.length,
          attempt,
          format: 'line-delimited',
        },
      });

      // Parse line-delimited response
      const translations = this.parseLineDelimitedResponse(response, texts.length);

      // Validate we got the same number of translations
      if (translations.length !== texts.length) {
        const error = new Error(
          `Translation count mismatch: expected ${texts.length}, got ${translations.length}`
        );

        // Retry with smaller batch if count mismatch on first attempt
        if (attempt <= MAX_RETRIES) {
          console.warn(
            `[LLM Translation] Count mismatch on attempt ${attempt}, retrying... (expected: ${texts.length}, got: ${translations.length})`
          );

          // If still getting wrong count, try splitting the batch
          if (attempt === MAX_RETRIES && texts.length > 10) {
            console.log('[LLM Translation] Splitting batch into smaller chunks after retry failure');
            const mid = Math.floor(texts.length / 2);
            const [first, second] = await Promise.all([
              this.translateBatchInternal(texts.slice(0, mid), targetLanguage, context, 1),
              this.translateBatchInternal(texts.slice(mid), targetLanguage, context, 1),
            ]);
            return [...first, ...second];
          }

          // Simple retry with same batch
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt)); // backoff
          return this.translateBatchInternal(texts, targetLanguage, context, attempt + 1);
        }

        throw error;
      }

      return translations;
    } catch (error) {
      console.error('[LLM Translation] Error:', {
        message: error instanceof Error ? error.message : String(error),
        textsCount: texts.length,
        attempt,
      });

      // Retry on parsing errors if we haven't exceeded MAX_RETRIES
      if (
        attempt <= MAX_RETRIES &&
        error instanceof Error &&
        (error.message.includes('mismatch') || error.message.includes('parse'))
      ) {
        console.warn(`[LLM Translation] Retrying due to parsing error on attempt ${attempt}`);
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt)); // backoff
        return this.translateBatchInternal(texts, targetLanguage, context, attempt + 1);
      }

      throw new Error(
        `LLM translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Parse line-delimited translation response
   */
  private parseLineDelimitedResponse(response: string, expectedCount: number): string[] {
    // Split by delimiter
    const parts = response.split(TRANSLATION_DELIMITER);

    // Filter out empty parts and trim
    const translations = parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    // If we have the expected count, return as-is
    if (translations.length === expectedCount) {
      return translations;
    }

    // Try alternative: split by double newlines
    if (translations.length !== expectedCount) {
      console.warn(
        `[LLM Translation] Delimiter split gave ${translations.length} items, trying double-newline split`
      );
      const altTranslations = response
        .split('\n\n')
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !part.includes('TRANSLATION'));

      if (altTranslations.length === expectedCount) {
        return altTranslations;
      }
    }

    // Try single newline split as last resort
    if (translations.length !== expectedCount) {
      console.warn(
        `[LLM Translation] Double-newline split gave ${translations.length || 'wrong count'} items, trying single-newline split`
      );
      const lines = response
        .split('\n')
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 &&
            !line.includes('TRANSLATION') &&
            !line.startsWith('TEXT ') && // Filter out "TEXT 0:", "TEXT 1:" labels
            !line.match(/^\d+\.?\s*$/) // Skip pure numbers
        );

      if (lines.length === expectedCount) {
        return lines;
      }
    }

    // Return what we have if count still doesn't match
    console.error(
      `[LLM Translation] Could not parse ${expectedCount} translations, got ${translations.length}`
    );
    return translations;
  }

  /**
   * Build line-delimited prompt for translation (more robust than JSON)
   */
  private buildLineDelimitedPrompt(
    texts: string[],
    targetLanguage: string,
    context?: TranslationContext
  ): string {
    const scenario = context?.scenario ?? 'general';
    const systemInstructions = this.getSystemInstructions(scenario, context);

    // Create numbered list of texts - using different format to avoid confusion
    const textsList = texts.map((text, i) => `TEXT ${i}:\n${text}`).join('\n\n');

    return `${systemInstructions}

TARGET LANGUAGE: ${targetLanguage}

YOU MUST TRANSLATE EXACTLY ${texts.length} TEXTS BELOW.

${textsList}

CRITICAL OUTPUT FORMAT REQUIREMENTS:
1. Translate ALL ${texts.length} texts above into ${targetLanguage}
2. Output ONLY the translated text itself - NO LABELS, NO NUMBERS, NO PREFIXES
3. Separate each translation with the delimiter: ${TRANSLATION_DELIMITER}
4. Maintain the EXACT same order as the input
5. DO NOT include "TEXT 0:", "TEXT 1:", or any index markers in your output
6. DO NOT include [0], [1], or any bracket notation in your output
7. DO NOT add explanations, notes, or any extra content
8. If a source text is empty, output an empty translation for that position

CORRECT EXAMPLE (for 3 English texts → Chinese):
假如这是第一段的翻译
${TRANSLATION_DELIMITER}
这是第二段的翻译
${TRANSLATION_DELIMITER}
这是第三段的翻译

WRONG EXAMPLE (DO NOT DO THIS):
TEXT 0: 假如这是第一段的翻译
${TRANSLATION_DELIMITER}
[1] 这是第二段的翻译
${TRANSLATION_DELIMITER}
2. 这是第三段的翻译

NOW OUTPUT ONLY THE ${texts.length} PURE TRANSLATIONS WITH NO LABELS:`;
  }

  /**
   * Build scenario-specific prompt for translation (legacy JSON format)
   * @deprecated Use buildLineDelimitedPrompt instead
   */
  private buildPrompt(
    texts: string[],
    targetLanguage: string,
    context?: TranslationContext
  ): string {
    const scenario = context?.scenario ?? 'general';
    const systemInstructions = this.getSystemInstructions(scenario, context);

    // Format texts with indices for clarity and count verification
    const indexedTexts = texts.map((text, i) => ({
      index: i,
      text: text,
    }));
    const textsJson = JSON.stringify(indexedTexts, null, 2);

    return `${systemInstructions}

TARGET LANGUAGE: ${targetLanguage}

TEXTS TO TRANSLATE (${texts.length} items):
${textsJson}

CRITICAL REQUIREMENTS:
1. You MUST translate ALL ${texts.length} texts
2. Return EXACTLY ${texts.length} translations in the same order
3. Each translation must correspond to the text at the same index
4. DO NOT merge, skip, or add extra translations
5. If a text is empty, return an empty string for that index
6. Maintain the exact same order as the input

Return ONLY a valid JSON object with this exact structure:
{
  "translations": [
    "translation for index 0",
    "translation for index 1",
    ...
    "translation for index ${texts.length - 1}"
  ]
}

IMPORTANT: The "translations" array must have EXACTLY ${texts.length} items.

Your response:`;
  }

  /**
   * Get scenario-specific system instructions
   */
  private getSystemInstructions(
    scenario: TranslationScenario,
    context?: TranslationContext
  ): string {
    const baseInstructions = `You are a professional translator specializing in technical and educational content.

CORE PRINCIPLES:
- Preserve technical terminology, code snippets, URLs, and proper nouns
- Maintain the original meaning and tone
- Use natural, fluent language in the target language
- Keep formatting (markdown, line breaks, bullets) intact`;

    const scenarioInstructions = this.getScenarioInstructions(scenario, context);

    return `${baseInstructions}

${scenarioInstructions}`;
  }

  /**
   * Get specific instructions for each translation scenario
   */
  private getScenarioInstructions(
    scenario: TranslationScenario,
    context?: TranslationContext
  ): string {
    switch (scenario) {
      case 'transcript':
        return `SCENARIO: Video Transcript Translation
${context?.videoTitle ? `VIDEO TITLE: "${context.videoTitle}"\n` : ''}
GUIDELINES:
- IMPORTANT: Correct apparent mistranscriptions when video context provides the proper term (e.g., if transcript says "Palunteer" but video title mentions "Palantir", use "Palantir")
- Preserve speaker attribution and timestamps if present
- Maintain conversational flow and natural speech patterns
- Keep technical terms related to the video topic in their original form when appropriate
- Handle filler words and informal speech naturally in the target language
- Preserve paragraph breaks and speaker changes

EXAMPLE:
Input: "So, um, what we're doing here with React hooks is..."
Output (zh-CN): "所以，嗯，我们在这里使用 React hooks 所做的是..."`;

      case 'chat':
        return `SCENARIO: Chat Message Translation
${context?.videoTitle ? `VIDEO TITLE: "${context.videoTitle}"\n` : ''}
GUIDELINES:
- Maintain conversational tone and personality
- Preserve markdown formatting (bold, italic, code blocks, links)
- Keep citations and references intact (e.g., [1:23], @mention)
- Handle informal language and emojis appropriately
- Preserve code snippets without translation
- Keep URLs and technical identifiers unchanged
- Use video context to understand domain-specific terms

EXAMPLE:
Input: "Great question! You can use \`useState\` hook for this. See [0:45] for details."
Output (zh-CN): "很好的问题！你可以使用 \`useState\` hook 来实现。详情请看 [0:45]。"`;

      case 'topic':
        return `SCENARIO: Topic/Highlight Translation
${context?.videoTitle ? `VIDEO TITLE: "${context.videoTitle}"\n` : ''}${context?.topicKeywords?.length ? `TOPIC KEYWORDS: ${context.topicKeywords.join(', ')}\n` : ''}
GUIDELINES:
- Translate topic titles to be concise and engaging
- Preserve technical keywords and terminology
- Keep quotes authentic to the original speaker's intent
- Maintain the educational and informative tone
- Preserve any special formatting in descriptions
- Use video context to understand domain-specific terms

EXAMPLE:
Input (title): "Advanced React Patterns: Compound Components"
Input (description): "Learn how to build flexible, reusable components..."
Output (zh-CN):
Title: "高级 React 模式：复合组件"
Description: "学习如何构建灵活、可复用的组件..."`;

      case 'general':
      default:
        return `SCENARIO: General Translation
GUIDELINES:
- Provide accurate, natural translation
- Preserve any technical terms and proper nouns
- Maintain original formatting and structure
- Keep the tone and style consistent with the source`;
    }
  }
}

/**
 * Extended translation function with context support
 */
export async function translateWithContext(
  texts: string[],
  targetLanguage: string,
  context: TranslationContext,
  client?: LLMTranslateClient
): Promise<string[]> {
  const translationClient = client ?? new LLMTranslateClient();
  return translationClient.translateBatch(texts, targetLanguage, context);
}
