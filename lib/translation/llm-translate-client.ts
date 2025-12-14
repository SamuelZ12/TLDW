import { z } from 'zod';
import { generateAIResponse } from '@/lib/ai-client';
import { getLanguageName } from '@/lib/language-utils';
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
 * Result of a translation attempt that may be partial
 */
interface TranslationResult {
  translations: (string | null)[]; // null means translation failed for this index
  successCount: number;
  failedIndices: number[];
}

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
   * Internal method to translate a batch with retry logic and partial result recovery
   */
  private async translateBatchInternal(
    texts: string[],
    targetLanguage: string,
    context?: TranslationContext,
    attempt: number = 1
  ): Promise<string[]> {
    const MAX_RETRIES = 2;
    // Use indexed prompt for better parsing reliability
    const prompt = this.buildIndexedPrompt(texts, targetLanguage, context);

    try {
      const response = await generateAIResponse(prompt, {
        temperature: this.temperature,
        maxOutputTokens: 16384,
        metadata: {
          operation: 'translation',
          scenario: context?.scenario ?? 'general',
          targetLanguage,
          textCount: texts.length,
          attempt,
          format: 'indexed',
        },
      });

      // Try indexed parsing first (more reliable)
      let result = this.parseIndexedResponse(response, texts.length);

      // If indexed parsing got nothing, try legacy delimiter parsing as fallback
      if (result.successCount === 0) {
        console.warn('[LLM Translation] Indexed parsing failed, trying delimiter fallback');
        const legacyTranslations = this.parseLineDelimitedResponse(response, texts.length);
        if (legacyTranslations.length > 0) {
          result = {
            translations: legacyTranslations.map(t => t || null),
            successCount: legacyTranslations.filter(Boolean).length,
            failedIndices: legacyTranslations
              .map((t, i) => t ? -1 : i)
              .filter(i => i >= 0),
          };
        }
      }

      // Perfect match - return immediately
      if (result.successCount === texts.length) {
        console.log(`[LLM Translation] ✓ All ${texts.length} translations successful`);
        return result.translations as string[];
      }

      // Calculate success rate
      const successRate = result.successCount / texts.length;

      // Complete failure - retry the whole batch
      if (result.successCount === 0 && attempt <= MAX_RETRIES) {
        console.warn(`[LLM Translation] Complete failure on attempt ${attempt}, retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        return this.translateBatchInternal(texts, targetLanguage, context, attempt + 1);
      }

      // Partial success with significant failures - retry just the failed items
      if (
        successRate < 0.9 &&
        attempt <= MAX_RETRIES &&
        result.failedIndices.length > 0 &&
        result.failedIndices.length <= 10
      ) {
        console.warn(
          `[LLM Translation] Partial success (${result.successCount}/${texts.length}) on attempt ${attempt}, retrying ${result.failedIndices.length} failed items...`
        );

        const failedTexts = result.failedIndices.map(i => texts[i]);
        try {
          const retriedTranslations = await this.translateBatchInternal(
            failedTexts,
            targetLanguage,
            context,
            attempt + 1
          );

          // Merge retried results back
          retriedTranslations.forEach((translation, idx) => {
            const originalIndex = result.failedIndices[idx];
            result.translations[originalIndex] = translation;
          });

          result.successCount = result.translations.filter(t => t !== null).length;
        } catch (retryError) {
          console.warn('[LLM Translation] Retry of failed items also failed, using partial results');
        }
      }

      // Return what we have, filling nulls with original text
      const finalTranslations = result.translations.map((translation, index) =>
        translation ?? texts[index]
      );

      const fallbackCount = texts.length - result.successCount;
      if (fallbackCount > 0) {
        console.warn(
          `[LLM Translation] Returning ${result.successCount}/${texts.length} translations (${fallbackCount} fell back to original)`
        );
      } else {
        console.log(`[LLM Translation] ✓ All ${texts.length} translations successful after retry`);
      }

      return finalTranslations;
    } catch (error) {
      console.error('[LLM Translation] Error:', {
        message: error instanceof Error ? error.message : String(error),
        textsCount: texts.length,
        attempt,
      });

      // On complete error, retry if attempts remain
      if (attempt <= MAX_RETRIES) {
        console.warn(`[LLM Translation] Retrying due to error on attempt ${attempt}`);
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        return this.translateBatchInternal(texts, targetLanguage, context, attempt + 1);
      }

      // Final fallback: return original texts (never throw)
      console.error('[LLM Translation] All retries exhausted, returning original texts');
      return texts;
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
   * Parse indexed translation response with explicit markers
   * Returns partial results with null for missing translations
   */
  private parseIndexedResponse(response: string, expectedCount: number): TranslationResult {
    const translations: (string | null)[] = new Array(expectedCount).fill(null);
    const failedIndices: number[] = [];
    let successCount = 0;

    // Pattern: [OUTPUT_N]...[/OUTPUT_N] - handles multiline content
    const pattern = /\[OUTPUT_(\d+)\]([\s\S]*?)\[\/OUTPUT_\1\]/g;
    let match;

    while ((match = pattern.exec(response)) !== null) {
      const index = parseInt(match[1], 10);
      const content = match[2].trim();

      if (index >= 0 && index < expectedCount) {
        translations[index] = content;
        successCount++;
      }
    }

    // Identify failed indices
    for (let i = 0; i < expectedCount; i++) {
      if (translations[i] === null) {
        failedIndices.push(i);
      }
    }

    return { translations, successCount, failedIndices };
  }

  /**
   * Build indexed prompt for translation (more robust than delimiter format)
   */
  private buildIndexedPrompt(
    texts: string[],
    targetLanguage: string,
    context?: TranslationContext
  ): string {
    const scenario = context?.scenario ?? 'general';
    const systemInstructions = this.getSystemInstructions(scenario, context);
    const languageName = getLanguageName(targetLanguage);

    // Create numbered list with explicit markers
    const textsList = texts.map((text, i) =>
      `[INPUT_${i}]\n${text}\n[/INPUT_${i}]`
    ).join('\n\n');

    return `${systemInstructions}

TARGET LANGUAGE: ${languageName}

TRANSLATE EXACTLY ${texts.length} TEXTS BELOW.

${textsList}

OUTPUT FORMAT REQUIREMENTS:
1. For each input, output: [OUTPUT_N] then the translation, then [/OUTPUT_N]
2. N must match the input index (0 to ${texts.length - 1})
3. Output ALL ${texts.length} translations in numerical order
4. Do NOT add explanations, labels, or extra content
5. For empty inputs, output empty content between tags

EXAMPLE OUTPUT FORMAT:
[OUTPUT_0]
First translated text here
[/OUTPUT_0]
[OUTPUT_1]
Second translated text here
[/OUTPUT_1]

NOW OUTPUT ALL ${texts.length} TRANSLATIONS:`;
  }

  /**
   * Build line-delimited prompt for translation (more robust than JSON)
   * @deprecated Use buildIndexedPrompt instead - kept as fallback
   */
  private buildLineDelimitedPrompt(
    texts: string[],
    targetLanguage: string,
    context?: TranslationContext
  ): string {
    const scenario = context?.scenario ?? 'general';
    const systemInstructions = this.getSystemInstructions(scenario, context);

    // Convert language code to human-readable name for clearer LLM instructions
    const languageName = getLanguageName(targetLanguage);

    // Create numbered list of texts - using different format to avoid confusion
    const textsList = texts.map((text, i) => `TEXT ${i}:\n${text}`).join('\n\n');

    return `${systemInstructions}

TARGET LANGUAGE: ${languageName}

YOU MUST TRANSLATE EXACTLY ${texts.length} TEXTS BELOW.

${textsList}

CRITICAL OUTPUT FORMAT REQUIREMENTS:
1. Translate ALL ${texts.length} texts above into ${languageName}
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

    // Convert language code to human-readable name for clearer LLM instructions
    const languageName = getLanguageName(targetLanguage);

    // Format texts with indices for clarity and count verification
    const indexedTexts = texts.map((text, i) => ({
      index: i,
      text: text,
    }));
    const textsJson = JSON.stringify(indexedTexts, null, 2);

    return `${systemInstructions}

TARGET LANGUAGE: ${languageName}

TEXTS TO TRANSLATE (${texts.length} items):
${textsJson}

CRITICAL REQUIREMENTS:
1. You MUST translate ALL ${texts.length} texts into ${languageName}
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
    const baseInstructions = `You are an expert linguist and translator specializing in converting spoken content into natural, native-sounding text.

CORE PRINCIPLES:
- Translate the *meaning* and *intent*, not just the words
- Use natural, fluent, and idiomatic language in the target language
- Avoid robotic, literal, or stiff phrasing
- Preserve code snippets, URLs, and specific proper nouns (names of people/places) exactly as is
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
- **Natural Flow:** Make the translation sound like a native speaker talking naturally. Rephrase sentences if needed to fit target language grammar and flow.
- **Filler Words:** Remove filler words (um, uh, like, you know) and false starts to improve readability and flow.
- **Mistranscriptions:** Use context to correct obvious speech-to-text errors.
- **Technical Terms:** Translate technical terms into their standard local equivalents. Only keep English if it is the strict industry standard in the target language.
- **Structure:** Preserve paragraph breaks and speaker changes.

EXAMPLE:
Input: "So, um, what we're doing here with React hooks is..."
Output (zh-CN): "我们在这里使用 React hooks 做的是..."`;

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
