import type { Resource } from "i18next";

import { assertValidLocaleMessages } from "./locale-validation";
import enShell from "./shell/en.json";
import ruShell from "./shell/ru.json";

export const DEFAULT_LOCALE = "ru" as const;
export const LOCALE_STORAGE_KEY = "paperclip.locale";

const localeModules = import.meta.glob("./locales/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export const localeMessages = Object.fromEntries(
  Object.entries(localeModules).map(([path, messages]) => {
    const locale = path.match(/\/([A-Za-z0-9_-]+)\.json$/)?.[1];
    if (!locale) {
      throw new Error(`Invalid locale file path: ${path}`);
    }
    return [locale, messages];
  }),
);

if (!(DEFAULT_LOCALE in localeMessages)) {
  throw new Error(`Missing default locale messages for ${DEFAULT_LOCALE}`);
}

for (const [locale, messages] of Object.entries(localeMessages)) {
  try {
    assertValidLocaleMessages(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${locale} locale messages: ${message}`);
  }
}

export const supportedLocales = Object.keys(localeMessages);

export function initialLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved && supportedLocales.includes(saved)) return saved;
  } catch {
    // Browser storage may be disabled; the Russian default still works.
  }
  return DEFAULT_LOCALE;
}

assertValidLocaleMessages(ruShell, enShell);

export const i18nextResources: Resource = Object.fromEntries(
  Object.entries(localeMessages).map(([locale, messages]) => [locale, {
    translation: messages,
    shell: locale === "ru" ? ruShell : enShell,
  }]),
) as Resource;

export type SupportedLocale = keyof typeof localeMessages;
