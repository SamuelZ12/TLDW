import {
  GoogleGenerativeAI,
  GenerationConfig,
  SchemaType
} from '@google/generative-ai';
import { z } from 'zod';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const MODEL_CASCADE = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
] as const;

type ValidModel = (typeof MODEL_CASCADE)[number];

interface GeminiModelConfig {
  generationConfig?: GenerationConfig;
  preferredModel?: string;
  timeoutMs?: number;
  zodSchema?: z.ZodType<any>;
}

function isValidModel(model: string): model is ValidModel {
  return MODEL_CASCADE.includes(model as ValidModel);
}

function isRetryableError(error: any): boolean {
  return (
    error?.status === 503 ||
    error?.status === 429 ||
    error?.message?.includes('503') ||
    error?.message?.includes('429') ||
    error?.message?.includes('overload') ||
    error?.message?.includes('rate limit')
  );
}

function getErrorType(error: any): string {
  if (
    error?.status === 503 ||
    error?.message?.includes('503') ||
    error?.message?.includes('overload')
  ) {
    return 'overloaded';
  }
  if (
    error?.status === 429 ||
    error?.message?.includes('429') ||
    error?.message?.includes('rate limit')
  ) {
    return 'rate limited';
  }
  if (
    error?.status === 401 ||
    error?.message?.includes('401') ||
    error?.message?.includes('unauthorized')
  ) {
    return 'authentication failed';
  }
  if (error?.status === 400 || error?.message?.includes('400')) {
    return 'invalid request';
  }
  return 'unknown error';
}

function convertToGeminiSchema(jsonSchema: any): any {
  if (jsonSchema.anyOf || jsonSchema.oneOf) {
    const schemas = jsonSchema.anyOf || jsonSchema.oneOf;
    const nonNullSchemas = schemas.filter((s: any) => s.type !== 'null');

    if (nonNullSchemas.length === 1) {
      const converted = convertToGeminiSchema(nonNullSchemas[0]);
      converted.nullable = true;
      return converted;
    }

    if (nonNullSchemas.length > 0) {
      return convertToGeminiSchema(nonNullSchemas[0]);
    }
  }

  if (jsonSchema.type === 'object') {
    const properties: Record<string, any> = {};
    const required: string[] = jsonSchema.required || [];

    for (const [key, value] of Object.entries(jsonSchema.properties || {})) {
      properties[key] = convertToGeminiSchema(value);
    }

    return {
      type: SchemaType.OBJECT,
      properties,
      required
    };
  }

  if (jsonSchema.type === 'array') {
    const arraySchema: Record<string, any> = {
      type: SchemaType.ARRAY,
      items: jsonSchema.items
        ? convertToGeminiSchema(jsonSchema.items)
        : { type: SchemaType.STRING }
    };

    if (typeof jsonSchema.minItems === 'number') {
      arraySchema.minItems = jsonSchema.minItems;
    }
    if (typeof jsonSchema.maxItems === 'number') {
      arraySchema.maxItems = jsonSchema.maxItems;
    }

    return arraySchema;
  }

  if (jsonSchema.type === 'string') {
    const stringSchema: Record<string, any> = { type: SchemaType.STRING };
    if (typeof jsonSchema.pattern === 'string') {
      stringSchema.pattern = jsonSchema.pattern;
    }
    return stringSchema;
  }

  if (jsonSchema.type === 'number' || jsonSchema.type === 'integer') {
    return { type: SchemaType.NUMBER };
  }

  if (jsonSchema.type === 'boolean') {
    return { type: SchemaType.BOOLEAN };
  }

  return { type: SchemaType.STRING };
}

export async function generateWithFallback(
  prompt: string,
  config: GeminiModelConfig = {}
): Promise<string> {
  if (config.preferredModel && !isValidModel(config.preferredModel)) {
    console.warn(
      `Invalid preferredModel "${config.preferredModel}", using default cascade`
    );
  }

  const models =
    config.preferredModel && isValidModel(config.preferredModel)
      ? [
          config.preferredModel,
          ...MODEL_CASCADE.filter((m) => m !== config.preferredModel)
        ]
      : [...MODEL_CASCADE];

  let lastError: any;
  const attemptedModels: string[] = [];

  for (const modelName of models) {
    attemptedModels.push(modelName);

    try {
      let generationConfig = config.generationConfig;
      const promptLength = prompt.length;

      if (config.zodSchema) {
        try {
          const jsonSchema = z.toJSONSchema(config.zodSchema);
          const geminiSchema = convertToGeminiSchema(jsonSchema);
          generationConfig = {
            ...generationConfig,
            responseMimeType: 'application/json',
            responseSchema: geminiSchema
          };
          console.log(`Using structured output with schema for ${modelName}`);
        } catch (schemaError) {
          console.error(
            `Failed to convert Zod schema to Gemini schema:`,
            schemaError
          );
          throw new Error(
            `Schema conversion failed: ${
              schemaError instanceof Error
                ? schemaError.message
                : 'Unknown error'
            }`
          );
        }
      }

      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig
      });

      const requestStart = Date.now();
      const generatePromise = model.generateContent(prompt);

      const result = config.timeoutMs
        ? await Promise.race([
            generatePromise,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Request timeout')),
                config.timeoutMs
              )
            )
          ])
        : await generatePromise;

      const latencyMs = Date.now() - requestStart;
      const geminiResponse = (result as any).response;
      const response = geminiResponse.text();

      if (response) {
        const usage = geminiResponse?.usageMetadata || {};
        const promptTokens = usage.promptTokenCount ?? 'n/a';
        const candidateTokens =
          usage.candidatesTokenCount ?? usage.outputTokenCount ?? 'n/a';
        const totalTokens = usage.totalTokenCount ?? 'n/a';
        console.log(
          `[Gemini][${modelName}] latency=${latencyMs}ms promptChars=${promptLength} ` +
            `promptTokens=${promptTokens} responseTokens=${candidateTokens} totalTokens=${totalTokens}`
        );
        console.log(`Content generated using ${modelName}`);
        return response;
      }

      console.warn(
        `Model ${modelName} returned empty response, trying next...`
      );
    } catch (error) {
      lastError = error;
      const errorType = getErrorType(error);

      if (!isRetryableError(error)) {
        console.error(
          `Model ${modelName} failed with non-retryable error (${errorType}):`,
          error
        );
        throw new Error(
          `Gemini API error (${errorType}): ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }

      console.log(`Model ${modelName} ${errorType}, trying next...`);
    }
  }

  const errorType = getErrorType(lastError);
  throw new Error(
    `All Gemini models failed after trying: ${attemptedModels.join(', ')}. ` +
      `Last error type: ${errorType}. ` +
      `${lastError instanceof Error ? lastError.message : 'Unknown error'}`
  );
}
