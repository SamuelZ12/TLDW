import { GoogleGenAI, DynamicRetrievalConfigMode } from '@google/genai';
import { z } from 'zod';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const MODEL_CASCADE = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
] as const;

type ValidModel = typeof MODEL_CASCADE[number];

interface GeminiConfig {
  temperature?: number;
  maxOutputTokens?: number;
  preferredModel?: string;
  timeoutMs?: number;
  zodSchema?: z.ZodType<any>;
  enableGoogleSearch?: boolean;
  dynamicRetrievalMode?: DynamicRetrievalConfigMode;
  dynamicThreshold?: number;
}

function isValidModel(model: string): model is ValidModel {
  return MODEL_CASCADE.includes(model as ValidModel);
}

function isRetryableError(error: any): boolean {
  return error?.status === 503 ||
         error?.status === 429 ||
         error?.message?.includes('503') ||
         error?.message?.includes('429') ||
         error?.message?.includes('overload') ||
         error?.message?.includes('rate limit');
}

function getErrorType(error: any): string {
  if (error?.status === 503 || error?.message?.includes('503') || error?.message?.includes('overload')) {
    return 'overloaded';
  }
  if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('rate limit')) {
    return 'rate limited';
  }
  if (error?.status === 401 || error?.message?.includes('401') || error?.message?.includes('unauthorized')) {
    return 'authentication failed';
  }
  if (error?.status === 400 || error?.message?.includes('400')) {
    return 'invalid request';
  }
  return 'unknown error';
}

/**
 * Convert Zod schema to Google GenAI schema format
 */
function convertToGenAISchema(jsonSchema: any): any {
  // Handle anyOf/oneOf (for optional fields)
  if (jsonSchema.anyOf || jsonSchema.oneOf) {
    const schemas = jsonSchema.anyOf || jsonSchema.oneOf;
    const nonNullSchemas = schemas.filter((s: any) => s.type !== 'null');

    if (nonNullSchemas.length === 1) {
      const converted = convertToGenAISchema(nonNullSchemas[0]);
      converted.nullable = true;
      return converted;
    }

    if (nonNullSchemas.length > 0) {
      return convertToGenAISchema(nonNullSchemas[0]);
    }
  }

  // Handle object type
  if (jsonSchema.type === 'object') {
    const properties: Record<string, any> = {};
    const required: string[] = jsonSchema.required || [];

    for (const [key, value] of Object.entries(jsonSchema.properties || {})) {
      properties[key] = convertToGenAISchema(value);
    }

    return {
      type: 'object',
      properties,
      required
    };
  }

  // Handle array type
  if (jsonSchema.type === 'array') {
    const arraySchema: Record<string, any> = {
      type: 'array',
      items: jsonSchema.items ? convertToGenAISchema(jsonSchema.items) : { type: 'string' }
    };

    if (typeof jsonSchema.minItems === 'number') {
      arraySchema.minItems = jsonSchema.minItems;
    }
    if (typeof jsonSchema.maxItems === 'number') {
      arraySchema.maxItems = jsonSchema.maxItems;
    }

    return arraySchema;
  }

  // Handle primitive types
  if (jsonSchema.type === 'string') {
    const stringSchema: Record<string, any> = { type: 'string' };
    if (typeof jsonSchema.pattern === 'string') {
      stringSchema.pattern = jsonSchema.pattern;
    }
    return stringSchema;
  }

  if (jsonSchema.type === 'number' || jsonSchema.type === 'integer') {
    return { type: 'number' };
  }

  if (jsonSchema.type === 'boolean') {
    return { type: 'boolean' };
  }

  return { type: 'string' };
}

/**
 * Generate content with model fallback and optional Google Search grounding
 */
export async function generateWithFallbackV2(
  prompt: string,
  config: GeminiConfig = {}
): Promise<string> {
  if (config.preferredModel && !isValidModel(config.preferredModel)) {
    console.warn(`Invalid preferredModel "${config.preferredModel}", using default cascade`);
  }

  const models = config.preferredModel && isValidModel(config.preferredModel)
    ? [config.preferredModel, ...MODEL_CASCADE.filter(m => m !== config.preferredModel)]
    : [...MODEL_CASCADE];

  let lastError: any;
  const attemptedModels: string[] = [];

  for (const modelName of models) {
    attemptedModels.push(modelName);

    try {
      const requestStart = Date.now();

      // Build generation config
      const generationConfig: any = {
        temperature: config.temperature ?? 0.6,
        maxOutputTokens: config.maxOutputTokens ?? 1024,
      };

      // Add structured output if schema provided
      if (config.zodSchema) {
        try {
          const jsonSchema = z.toJSONSchema(config.zodSchema);
          const genAISchema = convertToGenAISchema(jsonSchema);
          generationConfig.responseMimeType = "application/json";
          generationConfig.responseSchema = genAISchema;
          console.log(`Using structured output with schema for ${modelName}`);
        } catch (schemaError) {
          console.error(`Failed to convert Zod schema:`, schemaError);
          throw new Error(`Schema conversion failed: ${schemaError instanceof Error ? schemaError.message : 'Unknown error'}`);
        }
      }

      // Build tools array for Google Search grounding
      const tools: any[] = [];
      if (config.enableGoogleSearch) {
        const googleSearchTool: any = { googleSearch: {} };

        // Add dynamic retrieval config if specified
        if (config.dynamicRetrievalMode || config.dynamicThreshold) {
          googleSearchTool.googleSearch.dynamicRetrievalConfig = {
            mode: config.dynamicRetrievalMode ?? DynamicRetrievalConfigMode.MODE_DYNAMIC,
            dynamicThreshold: config.dynamicThreshold ?? 0.7,
          };
        }

        tools.push(googleSearchTool);
        console.log(`Enabled Google Search grounding for ${modelName}`);
      }

      // Build request config
      const requestConfig: any = {
        ...generationConfig,
      };

      if (tools.length > 0) {
        requestConfig.tools = tools;
      }

      // Generate content
      const generatePromise = ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: requestConfig,
      });

      const result: any = config.timeoutMs
        ? await Promise.race([
            generatePromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Request timeout')), config.timeoutMs)
            )
          ])
        : await generatePromise;

      const latencyMs = Date.now() - requestStart;

      // Extract response text
      const response = result?.text;

      if (response) {
        // Log usage metrics if available
        const usage = (result as any).usageMetadata;
        if (usage) {
          const promptTokens = usage.promptTokenCount ?? 'n/a';
          const candidateTokens = usage.candidatesTokenCount ?? usage.outputTokenCount ?? 'n/a';
          const totalTokens = usage.totalTokenCount ?? 'n/a';
          console.log(
            `[GenAI][${modelName}] latency=${latencyMs}ms promptChars=${prompt.length} ` +
            `promptTokens=${promptTokens} responseTokens=${candidateTokens} totalTokens=${totalTokens}`
          );
        }

        // Log grounding metadata if available
        const groundingMetadata = (result as any).groundingMetadata;
        if (groundingMetadata) {
          console.log(`[GenAI][${modelName}] Grounding metadata:`, JSON.stringify(groundingMetadata, null, 2));
        }

        console.log(`Content generated using ${modelName}`);
        return response;
      }

      console.warn(`Model ${modelName} returned empty response, trying next...`);
    } catch (error) {
      lastError = error;
      const errorType = getErrorType(error);

      if (!isRetryableError(error)) {
        console.error(`Model ${modelName} failed with non-retryable error (${errorType}):`, error);
        throw new Error(`Gemini API error (${errorType}): ${error instanceof Error ? error.message : 'Unknown error'}`);
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

/**
 * Generate content with Google Search grounding enabled
 */
export async function generateWithGrounding(
  prompt: string,
  config: Omit<GeminiConfig, 'enableGoogleSearch'> = {}
): Promise<string> {
  return generateWithFallbackV2(prompt, {
    ...config,
    enableGoogleSearch: true,
  });
}
