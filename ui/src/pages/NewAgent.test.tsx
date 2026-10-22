// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { ApiError } from "@/api/client";
import { api, envApi, settings, secrets, state, managedApi, root, container, cache, settle, click, fill, render, pass, renderCurrentParams } from "./NewAgent.test-support";

describe("New agent setup", () => {
  it.each(["codex_local", "claude_local", "paperclip_runner", "pi_local"])("offers only URL/key/model even for a %s deep link", async adapter => {
    await render(adapter, "copilot");
    expect(api.create.mock.calls[0][1]).toMatchObject({ adapterType: "pi_local", runner: "legacy", adapterConfig: {} });
    expect(container.querySelector('[aria-label="URL API"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="API key provider"]')).toBeNull();
    expect(container.querySelector('[aria-label="Runner"]')).toBeNull();
    expect(api.adapterModels).not.toHaveBeenCalled();
    expect(managedApi.list).not.toHaveBeenCalled();
  });

  it("creates a local API agent without vendor discovery or a key", async () => {
    secrets.list.mockResolvedValue([{ id: "unrelated-openai-key", name: "Unrelated OpenAI key", key: "OPENAI_API_KEY", status: "active" }]);
    await render("pi_local");
    expect(api.adapterModels).not.toHaveBeenCalled();
    expect(container.querySelector('[role="combobox"][aria-label="Connection"]')).toBeNull();
    await fill("URL API", "http://localhost:11434/v1");
    await fill("Модель", "qwen3-coder:30b");
    await click("Завершить настройку");
    expect(api.hire.mock.calls[0][1]).toMatchObject({ adapterType: "pi_local", runner: "legacy",
      adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/qwen3-coder:30b" } });
    expect(api.hire.mock.calls[0][1].adapterConfig.env?.OPENAI_API_KEY).toBeUndefined();
    expect(api.hire.mock.calls[0][1].runtimeConfig.aiConnection).toBeUndefined();
    expect(secrets.create).not.toHaveBeenCalled();
  });

  it("tests a corporate API key and stores only its secret reference", async () => {
    await render("pi_local");
    await fill("URL API", "https://llm.example.internal/v1");
    await fill("Модель", "Qwen/Qwen3-Coder");
    await fill("OPENAI_API_KEY", "corporate-test-key");
    await click("Завершить настройку");
    expect(api.testEnvironment.mock.calls[0][2]).toMatchObject({ runner: "legacy",
      adapterConfig: { baseUrl: "https://llm.example.internal/v1", model: "local/Qwen/Qwen3-Coder" },
      testCredentials: { OPENAI_API_KEY: "corporate-test-key" } });
    expect(api.hire.mock.calls[0][1].adapterConfig.env.OPENAI_API_KEY).toEqual({ type: "secret_ref", secretId: "org-secret-1", version: "latest" });
    expect(JSON.stringify(api.hire.mock.calls)).not.toContain("corporate-test-key");
    expect(api.adapterModels).not.toHaveBeenCalled();
  });

  it.each(["ftp://localhost/v1", "http://user:pass@localhost/v1", "http://localhost/v1?key=secret", "http://localhost/v1#fragment"])("rejects an invalid local API URL %s before testing", async url => {
    await render("pi_local");
    await fill("URL API", url);
    await fill("Модель", "local-model");
    await click("Run test");
    expect(api.testEnvironment).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Укажите URL API");
  });

  it("restores a local API draft and its model after navigation", async () => {
    await render("pi_local");
    await fill("URL API", "http://inference.lan:8000/v1");
    await fill("Модель", "Qwen/Qwen3-Coder");
    await click("Сохранить и выйти");
    const setupId = api.create.mock.calls[0][1].setupId;
    await act(async () => root.render(null));
    cache.clear();
    state.params = new URLSearchParams({ name: "Atlas", adapterType: "pi_local", setupAgentId: setupId });
    await renderCurrentParams();
    await settle();
    expect((container.querySelector('[aria-label="URL API"]') as HTMLInputElement).value).toBe("http://inference.lan:8000/v1");
    expect((container.querySelector('[aria-label="Модель"]') as HTMLInputElement).value).toBe("Qwen/Qwen3-Coder");
    await click("Завершить настройку");
    expect(api.hire.mock.calls[0][1].adapterConfig.model).toBe("local/Qwen/Qwen3-Coder");
  });


  it("keeps a new name-and-adapter Pi draft on the local API route", async () => {
    const setupId = "00000000-0000-4000-8000-000000000094";
    state.params = new URLSearchParams({ name: "Atlas", adapterType: "pi_local", setupAgentId: setupId });
    api.get.mockResolvedValue({ id: setupId, companyId: "company-1", name: "Atlas", adapterType: "pi_local", adapterConfig: {}, runtimeConfig: {}, pauseReason: "setup", status: "paused" });
    await renderCurrentParams();
    await settle();
    expect(container.querySelector('[aria-label="URL API"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="API key provider"]')).toBeNull();
    expect(api.adapterModels).not.toHaveBeenCalled();
    await fill("URL API", "http://localhost:11434/v1");
    await fill("Модель", "qwen3:8b");
    await click("Завершить настройку");
    expect(api.hire.mock.calls[0][1]).toMatchObject({ adapterType: "pi_local", runner: "legacy", adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/qwen3:8b" } });
  });

  it.each([false, true])("drops cloud connection and credentials when switching to local (new key: %s)", async typedKey => {
    const setupId = "00000000-0000-4000-8000-000000000095";
    const previousKey = { type: "secret_ref", secretId: "old-cloud-secret", version: "latest" };
    state.params = new URLSearchParams({ name: "Atlas", adapterType: "pi_local", setupAgentId: setupId });
    api.get.mockResolvedValue({ id: setupId, companyId: "company-1", name: "Atlas", adapterType: "pi_local",
      adapterConfig: { model: "openai/cloud-model", env: { CLAUDE_CODE_OAUTH_TOKEN: { type: "secret_ref", secretId: "old-claude-token", version: "latest" }, OPENAI_API_KEY: previousKey } },
      runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "responsible_user" } }, pauseReason: "setup", status: "paused" });
    await renderCurrentParams();
    await settle();
    await fill("URL API", "http://localhost:11434/v1");
    await fill("Модель", "qwen3:8b");
    if (typedKey) await fill("OPENAI_API_KEY", "new-local-key");
    await click("Run test");
    expect(api.testEnvironment.mock.calls[0][2].aiConnection).toBeUndefined();
    expect(api.testEnvironment.mock.calls[0][2].adapterConfig.env?.OPENAI_API_KEY).toBeUndefined();
    expect(api.testEnvironment.mock.calls[0][2].testCredentials).toEqual(typedKey ? { OPENAI_API_KEY: "new-local-key" } : {});
    await click("Завершить настройку");
    expect(api.hire.mock.calls[0][1].runtimeConfig.aiConnection).toBeUndefined();
    expect(api.hire.mock.calls[0][1].adapterConfig.env?.OPENAI_API_KEY).toEqual(typedKey ? { type: "secret_ref", secretId: "org-secret-1", version: "latest" } : undefined);
    expect(JSON.stringify(api.hire.mock.calls)).not.toContain("old-cloud-secret");
    expect(JSON.stringify(api.hire.mock.calls)).not.toContain("old-claude-token");
  });

  it("keeps a restored local key only until the endpoint changes", async () => {
    const setupId = "00000000-0000-4000-8000-000000000096";
    const previousKey = { type: "secret_ref", secretId: "old-local-secret", version: "latest" };
    state.params = new URLSearchParams({ name: "Atlas", adapterType: "pi_local", setupAgentId: setupId });
    api.get.mockResolvedValue({ id: setupId, companyId: "company-1", name: "Atlas", adapterType: "pi_local",
      adapterConfig: { baseUrl: "https://old.example.internal/v1", model: "local/qwen3:8b", env: { OPENAI_API_KEY: previousKey } }, runtimeConfig: {}, pauseReason: "setup", status: "paused" });
    await renderCurrentParams();
    await settle();
    await click("Run test");
    expect(api.testEnvironment.mock.calls[0][2].adapterConfig.env.OPENAI_API_KEY).toEqual(previousKey);
    await fill("URL API", "http://localhost:11434/v1");
    await click("Run test");
    expect(api.testEnvironment.mock.calls[1][2].adapterConfig.env.OPENAI_API_KEY).toBeUndefined();
    expect(api.testEnvironment.mock.calls[1][2].testCredentials).toEqual({});
  });



  it("creates a Pi setup draft directly from the name without a provider picker", async () => {
    state.params = new URLSearchParams();
    await renderCurrentParams();
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Например, Алексей"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Начальник");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Настроить агента"))!.click());
    await settle();
    expect(api.create.mock.calls[0][1]).toMatchObject({ name: "Начальник", adapterType: "pi_local", runner: "legacy", adapterConfig: {} });
    expect(document.querySelector('input[name="new-agent-adapter"]')).toBeNull();
    expect(state.navigate).toHaveBeenLastCalledWith(expect.stringContaining("setupAgentId="), { replace: true });
  });

  it("resumes an old name-only draft without replacing its identity or saved state", async () => {
    const id = "00000000-0000-4000-8000-000000000098";
    state.params = new URLSearchParams({ name: "Начальник", adapterType: "process", setupAgentId: id });
    api.get.mockResolvedValue({ id, companyId: "company-1", name: "Начальник", adapterType: "process", adapterConfig: { cwd: "/saved/work" }, runtimeConfig: {}, metadata: { setupAdapterPending: true, keep: "value" }, pauseReason: "setup", status: "paused" });
    await renderCurrentParams(); await settle();
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Настроить агента"))!.click());
    await settle();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith(id, { name: "Начальник", adapterType: "pi_local", runner: "legacy", metadata: { setupAdapterPending: false, keep: "value" } }, "company-1");
  });

  it("retries draft creation with the same identity", async () => {
    api.create.mockRejectedValueOnce(new Error("Creation unavailable"));
    await render();
    expect(container.textContent).toContain("Creation unavailable");
    await click("Повторить");
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.create.mock.calls[1][1].setupId).toBe(api.create.mock.calls[0][1].setupId);
    expect(container.querySelector('[aria-label="URL API"]')).not.toBeNull();
  });

  it("saves an incomplete URL/model draft without testing or hiring", async () => {
    await render();
    await click("Сохранить и выйти");
    expect(api.update.mock.calls[0][1]).toMatchObject({ adapterType: "pi_local", runner: "legacy", adapterConfig: { baseUrl: "", model: "" } });
    expect(api.hire).not.toHaveBeenCalled();
    expect(api.testEnvironment).not.toHaveBeenCalled();
  });

  it("retains the first agent role and setup identity when finalization is retried", async () => {
    api.list.mockResolvedValue([]);
    api.hire.mockRejectedValueOnce(new Error("Hire unavailable"));
    await render();
    await fill("URL API", "http://localhost:11434/v1"); await fill("Модель", "qwen3:8b");
    await click("Завершить настройку");
    expect(container.textContent).toContain("Hire unavailable");
    await click("Завершить настройку");
    expect(api.hire).toHaveBeenCalledTimes(2);
    expect(api.hire.mock.calls[1][1]).toMatchObject({ setupAgentId: api.create.mock.calls[0][1].setupId, role: "ceo" });
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed key transient until a successful test", async () => {
    api.testEnvironment.mockResolvedValueOnce({ ...pass, status: "fail" });
    await render(); await fill("URL API", "https://llm.internal/v1"); await fill("Модель", "local/model"); await fill("OPENAI_API_KEY", "bad-key");
    await click("Завершить настройку");
    expect(api.hire).not.toHaveBeenCalled(); expect(secrets.create).not.toHaveBeenCalled();
    await fill("OPENAI_API_KEY", "good-key"); await click("Завершить настройку");
    expect(api.hire).toHaveBeenCalledTimes(1); expect(secrets.create).toHaveBeenCalledTimes(1);
    expect(api.hire.mock.calls[0][1].adapterConfig.model).toBe("local/model");
  });

  it("removes a staged secret after a rejected save and preserves the setup draft", async () => {
    api.update.mockRejectedValueOnce(new ApiError("Invalid config", 400, null));
    await render(); await fill("URL API", "https://llm.internal/v1"); await fill("Модель", "model"); await fill("OPENAI_API_KEY", "new-key");
    await click("Завершить настройку");
    expect(secrets.remove).toHaveBeenCalledWith("org-secret-1"); expect(api.hire).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("retains a staged secret when the save response is lost", async () => {
    api.update.mockRejectedValueOnce(new Error("Network lost"));
    await render(); await fill("URL API", "https://llm.internal/v1"); await fill("Модель", "model"); await fill("OPENAI_API_KEY", "new-key");
    await click("Завершить настройку");
    expect(secrets.remove).not.toHaveBeenCalled();
    await click("Завершить настройку");
    expect(secrets.create).toHaveBeenCalledTimes(1);
    expect(api.hire.mock.calls[0][1].adapterConfig.env.OPENAI_API_KEY).toMatchObject({ type: "secret_ref", secretId: "org-secret-1" });
  });

  it("drops a test result when the environment changes while it is pending", async () => {
    let release!: (result: object) => void;
    api.testEnvironment.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    await render(); await fill("URL API", "http://localhost:11434/v1"); await fill("Модель", "model");
    await click("Run test");
    await act(async () => cache.setQueryData(queryKeys.environments.list("company-1"), [{ id: "local-1", name: "Local", driver: "local", config: { revision: "changed" } }]));
    await act(async () => release(pass)); await settle();
    expect([...container.querySelectorAll("button")].some(button => button.textContent?.trim() === "Run test")).toBe(true);
    expect(api.hire).not.toHaveBeenCalled();
  });

});
