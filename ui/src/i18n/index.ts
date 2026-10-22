import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";

import { DEFAULT_LOCALE, initialLocale, i18nextResources, LOCALE_STORAGE_KEY, supportedLocales } from "./locales";

function syncLocale(locale: string) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Changing the language remains available without browser storage.
  }
}

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  ns: ["translation", "shell"],
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

i18n.on("languageChanged", syncLocale);

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export const useTranslation = useReactI18nextTranslation;
export { i18n };
