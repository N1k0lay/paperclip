import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runProbe, discoverModels, stageRuntime, restoreWorkspace } = vi.hoisted(() => ({
  runProbe: vi.fn(), discoverModels: vi.fn(), stageRuntime: vi.fn(), restoreWorkspace: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => ({
  ...await vi.importActual("@paperclipai/adapter-utils/execution-target"),
  ensureAdapterExecutionTargetDirectory: vi.fn(),
  ensureAdapterExecutionTargetCommandResolvable: vi.fn(),
  maybeRunSandboxInstallCommand: vi.fn(),
  runAdapterExecutionTargetProcess: runProbe,
  prepareAdapterExecutionTargetRuntime: stageRuntime,
}));
vi.mock("./models.js", () => ({ discoverPiModelsCached: discoverModels }));

import { testEnvironment } from "./test.js";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("Pi local endpoint environment probe", () => {
  it("uses the configured endpoint and raw model without vendor discovery or ambient credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "host-owner-secret");
    let configDir = "";
    runProbe.mockImplementationOnce(async (_run, _target, _command, args, options) => {
      configDir = options.env.PI_CODING_AGENT_DIR;
      const registry = JSON.parse(await fs.readFile(path.join(configDir, "models.json"), "utf8"));
      expect(registry.providers.local).toMatchObject({ baseUrl: "http://127.0.0.1:11434/v1", models: [{ id: "vendor/model:latest" }] });
      expect(options.env.PAPERCLIP_PI_LOCAL_API_KEY).toBe("paperclip-local-no-auth");
      expect(options.env.PI_OFFLINE).toBe("1");
      expect(args).toEqual(expect.arrayContaining(["--provider", "local", "--model", "vendor/model:latest"]));
      return { exitCode: 0, stdout: JSON.stringify({ type: "turn_end", message: { role: "assistant", content: "hello" } }), stderr: "", timedOut: false };
    });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "pi_local",
      config: { baseUrl: "http://127.0.0.1:11434/v1", model: "vendor/model:latest" },
    });
    expect(result.status).toBe("pass");
    expect(discoverModels).not.toHaveBeenCalled();
    await expect(fs.access(configDir)).rejects.toThrow();
  });

  it("redacts a bound API key if a failing endpoint echoes it", async () => {
    const key = "!literal-corporate-secret";
    runProbe.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: `Invalid API key ${key}`, timedOut: false });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "pi_local",
      config: { baseUrl: "https://gateway.example/v1", model: "local/qwen", env: { OPENAI_API_KEY: key } },
    });
    expect(runProbe.mock.calls[0][4].env.PAPERCLIP_PI_LOCAL_API_KEY).toBe(key);
    expect(result.status).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "pi_hello_probe_auth_required", detail: "Invalid API key [REDACTED]" }));
  });

  it("stages the same managed provider for remote probes and cleans up both copies", async () => {
    let configDir = "";
    let workspaceDir = "";
    stageRuntime.mockImplementationOnce(async (input) => {
      configDir = input.assets[0].localDir;
      workspaceDir = input.workspaceLocalDir;
      expect(JSON.parse(await fs.readFile(path.join(configDir, "models.json"), "utf8")).providers.local.models).toEqual([{ id: "qwen" }]);
      return { workspaceRemoteDir: "/remote/workspace", assetDirs: { agentConfig: "/remote/config" }, restoreWorkspace };
    });
    runProbe.mockImplementationOnce(async (_run, _target, _command, _args, options) => {
      expect(options.env.PI_CODING_AGENT_DIR).toBe("/remote/config");
      return { exitCode: 0, stdout: JSON.stringify({ type: "turn_end", message: { role: "assistant", content: "hello" } }), stderr: "", timedOut: false };
    });
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "pi_local", environmentName: "Fixture remote",
      executionTarget: { kind: "remote", transport: "ssh", remoteCwd: "/remote/workspace", spec: { host: "fixture", username: "fixture", remoteCwd: "/remote/workspace" } } as never,
      config: { baseUrl: "http://localhost:8080/v1", model: "local/qwen" },
    });
    expect(result.status).toBe("pass");
    expect(restoreWorkspace).toHaveBeenCalledOnce();
    expect(discoverModels).not.toHaveBeenCalled();
    await expect(fs.access(configDir)).rejects.toThrow();
    await expect(fs.access(workspaceDir)).rejects.toThrow();
  });

  it("fails invalid URL configuration before starting the runtime without exposing URL credentials", async () => {
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "pi_local",
      config: { baseUrl: "http://user:secret@localhost/v1", model: "local/qwen" },
    });
    expect(result.status).toBe("fail");
    expect(result.checks[0].code).toBe("pi_provider_config_invalid");
    expect(JSON.stringify(result)).not.toContain("user:secret");
    expect(runProbe).not.toHaveBeenCalled();
  });

  it("refuses vendor models without an explicit endpoint before any runtime discovery", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "pi_local", config: { model: "openai/model" } });
    expect(result.status).toBe("fail");
    expect(discoverModels).not.toHaveBeenCalled();
    expect(runProbe).not.toHaveBeenCalled();
  });
});
