// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { RuntimeTestCard } from "./RuntimeTestCard";
import { i18n } from "@/i18n";

afterEach(async () => { await i18n.changeLanguage("en"); });

it.each([
  ["idle", "Проверьте агента", "Проверить"],
  ["running", "Проверяем подключение", "Проверка…"],
  ["pass", "Подключение работает", "Проверить снова"],
  ["warn", "Проверьте подключение", "Проверить снова"],
  ["fail", "Не удалось подключиться", "Повторить проверку"],
] as const)("renders the Russian connection state %s", async (state, title, action) => {
  await i18n.changeLanguage("ru");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<RuntimeTestCard state={state} onTest={() => {}} result={null} />));
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Проверка среды выполнения");
    expect(container.querySelector("h3")?.textContent).toBe(title);
    expect(container.querySelector("button")?.textContent).toBe(action);
    expect(container.querySelector("button")?.disabled).toBe(state === "running");
  } finally {
    flushSync(() => root.unmount());
  }
});

it("translates prerequisites and details while preserving provider diagnostics", async () => {
  await i18n.changeLanguage("ru");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<RuntimeTestCard variant="prerequisites" state="warn" onTest={() => {}} result={{
      adapterType: "pi_local", status: "warn", testedAt: "2026-10-23T11:00:00Z",
      checks: [{ code: "provider_note", level: "warn", message: "Original provider diagnostic" }],
    }} />));
    expect(container.querySelector("h3")?.textContent).toBe("Требуется сопряжение");
    expect(container.querySelector("summary")?.textContent).toContain("Результаты проверки");
    expect(container.textContent).toContain("Original provider diagnostic");
  } finally {
    flushSync(() => root.unmount());
  }
});

it("shows the installation repair directly on a missing runtime test", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const message = "The ACPX claude runtime is incomplete: required package @agentclientprotocol/claude-agent-acp is missing. Reinstall or rebuild Paperclip with its bundled provider dependencies, restart the server, then test the agent's runtime before retrying.";
  try {
    flushSync(() => root.render(<RuntimeTestCard state="fail" onTest={() => {}} result={{
      adapterType: "paperclip_runner", status: "fail", testedAt: "2026-10-11T11:19:14Z",
      checks: [{ code: "acpx_runtime_package_missing", level: "error", message }],
    }} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Runtime missing");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(container.textContent).not.toContain("Check your model and provider connection");
  } finally {
    flushSync(() => root.unmount());
  }
});
