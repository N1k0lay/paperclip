// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from ".";
import { DEFAULT_LOCALE, initialLocale, LOCALE_STORAGE_KEY } from "./locales";
import { validateLocaleMessages } from "./locale-validation";
import enShell from "./shell/en.json";
import ruShell from "./shell/ru.json";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("Russian interface", () => {
  it("defaults to Russian for a new browser and invalid saved languages", () => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    expect(DEFAULT_LOCALE).toBe("ru");
    expect(initialLocale()).toBe("ru");
    localStorage.setItem(LOCALE_STORAGE_KEY, "unknown");
    expect(initialLocale()).toBe("ru");
  });

  it("restores the saved language", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(initialLocale()).toBe("en");
    localStorage.setItem(LOCALE_STORAGE_KEY, "ru");
    expect(initialLocale()).toBe("ru");
  });

  it("translates the shell and keeps the document language and saved choice in sync", async () => {
    await i18n.changeLanguage("ru");
    expect(i18n.t("nav.tasks", { ns: "shell" })).toBe("Задачи");
    expect(i18n.t("company.inviteNamed", { ns: "shell", name: "Команда" })).toBe("Пригласить в организацию Команда");
    expect(document.documentElement.lang).toBe("ru");
    expect(initialLocale()).toBe("ru");

    await i18n.changeLanguage("en");
    expect(i18n.t("nav.tasks", { ns: "shell" })).toBe("Tasks");
    expect(document.documentElement.lang).toBe("en");
    expect(initialLocale()).toBe("en");
  });

  it("keeps language switching available when storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Storage blocked"); },
      setItem: () => { throw new Error("Storage blocked"); },
    });
    expect(initialLocale()).toBe("ru");
    await expect(i18n.changeLanguage("ru")).resolves.toBeDefined();
    expect(document.documentElement.lang).toBe("ru");
  });

  it("provides a Russian translation for every shell key with matching placeholders", () => {
    expect(validateLocaleMessages(ruShell, enShell)).toEqual([]);
  });
});
