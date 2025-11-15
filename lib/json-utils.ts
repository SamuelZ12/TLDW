/**
 * Utility functions for safely parsing JSON responses from AI models
 *
 * AI models sometimes return JSON wrapped in markdown code fences or with
 * extra whitespace/text. These utilities clean and extract the JSON payload.
 */

/**
 * Extracts JSON payload from AI model responses that may contain:
 * - Markdown code fences (```json ... ```)
 * - Extra whitespace or text before/after JSON
 * - Raw JSON arrays or objects
 *
 * @param raw - Raw string response from AI model
 * @returns Cleaned JSON string ready for parsing
 *
 * @example
 * ```typescript
 * const response = "```json\n{\"key\": \"value\"}\n```";
 * const cleaned = extractJsonPayload(response);
 * const parsed = JSON.parse(cleaned); // { key: "value" }
 * ```
 */
export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  // Try to extract content from markdown code fences like ```json ... ```
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  // Try to extract JSON array
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }

  // Try to extract JSON object
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }

  return trimmed;
}

/**
 * Safely parses JSON with automatic cleaning of AI model responses
 *
 * @param raw - Raw string response that may contain JSON
 * @returns Parsed JSON object or throws if parsing fails
 * @throws {SyntaxError} If the cleaned string is not valid JSON
 *
 * @example
 * ```typescript
 * try {
 *   const data = safeJsonParse<MyType>("```json\n{\"key\": \"value\"}\n```");
 *   console.log(data.key); // "value"
 * } catch (error) {
 *   console.error('Failed to parse JSON:', error);
 * }
 * ```
 */
export function safeJsonParse<T = unknown>(raw: string): T {
  const cleaned = extractJsonPayload(raw);
  return JSON.parse(cleaned) as T;
}
