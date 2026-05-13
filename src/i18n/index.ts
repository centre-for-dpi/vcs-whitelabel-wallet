import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import en from './locales/en';
import es from './locales/es';
import fr from './locales/fr';

export const LANGUAGE_KEY = 'app-language';
export const SUPPORTED_LANGS = ['en', 'es', 'fr'] as const;
export type Language = (typeof SUPPORTED_LANGS)[number];

function deviceLanguage(): Language {
  const code = Localization.getLocales()[0]?.languageCode ?? 'en';
  return (SUPPORTED_LANGS as readonly string[]).includes(code) ? (code as Language) : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
  },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

/** Called once at app startup — overrides device locale with saved preference if any. */
export async function initLanguagePreference(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(LANGUAGE_KEY);
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) {
      await i18n.changeLanguage(stored);
    }
  } catch { /* ignore */ }
}

/** Persists the user's choice and updates the running i18n instance. */
export async function setLanguagePreference(lang: Language): Promise<void> {
  await SecureStore.setItemAsync(LANGUAGE_KEY, lang);
  await i18n.changeLanguage(lang);
}

export default i18n;
