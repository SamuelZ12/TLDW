/**
 * Supported languages for translation
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh-CN', name: 'Simplified Chinese', nativeName: '简体中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' }
] as const;

/**
 * Get the natural language name from a language code
 * @param code - Language code (e.g., 'zh-CN', 'ja', 'fr')
 * @returns Natural language name (e.g., 'Simplified Chinese', 'Japanese', 'French')
 */
export function getLanguageName(code: string): string {
  const language = SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
  if (!language) {
    return 'English'; // Default fallback
  }

  return language.name;
}
