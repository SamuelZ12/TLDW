export const locales = ['en', 'zh', 'ja'] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '简体中文',
  ja: '日本語'
};