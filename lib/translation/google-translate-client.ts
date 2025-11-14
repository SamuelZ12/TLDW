import { v2 as Translate } from '@google-cloud/translate';
import type { TranslationProvider, TranslationError } from './types';

export class GoogleTranslateClient implements TranslationProvider {
  private client: Translate.Translate;

  constructor(apiKey?: string) {
    if (!apiKey) {
      throw new Error('Google Translate API key is required');
    }

    this.client = new Translate.Translate({
      key: apiKey,
      projectId: 'tldw-translation', // This can be any string for API key auth
    });
  }

  async translate(text: string, targetLanguage: string): Promise<string> {
    if (!text || text.trim() === '') {
      return text;
    }

    try {
      const [translation] = await this.client.translate(text, {
        to: targetLanguage,
        format: 'text',
      });

      return translation || text;
    } catch (error) {
      const translationError: TranslationError = new Error(
        `Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      translationError.code = 'TRANSLATION_FAILED';
      translationError.details = error;
      throw translationError;
    }
  }

  async translateBatch(texts: string[], targetLanguage: string): Promise<string[]> {
    if (texts.length === 0) {
      return [];
    }

    // Filter out empty texts but keep track of their positions
    const nonEmptyTexts: string[] = [];
    const indexMap: number[] = [];

    texts.forEach((text, index) => {
      if (text && text.trim() !== '') {
        nonEmptyTexts.push(text);
        indexMap.push(index);
      }
    });

    if (nonEmptyTexts.length === 0) {
      return texts;
    }

    try {
      const [translations] = await this.client.translate(nonEmptyTexts, {
        to: targetLanguage,
        format: 'text',
      });

      // Reconstruct the full array with translations in the correct positions
      const result = [...texts];
      translations.forEach((translation, i) => {
        const originalIndex = indexMap[i];
        result[originalIndex] = translation || texts[originalIndex];
      });

      return result;
    } catch (error) {
      const translationError: TranslationError = new Error(
        `Batch translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      translationError.code = 'BATCH_TRANSLATION_FAILED';
      translationError.details = error;
      throw translationError;
    }
  }
}