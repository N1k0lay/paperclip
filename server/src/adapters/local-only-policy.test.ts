import { afterEach, describe, expect, it, vi } from "vitest";
const { externalLoad } = vi.hoisted(() => ({ externalLoad: vi.fn(async () => []) }));
vi.mock("./plugin-loader.js", () => ({ buildExternalAdapters: externalLoad }));
import {
  listServerAdapters, getServerAdapter, requireServerAdapter, registerServerAdapter,
  listAdapterModels, refreshAdapterModels, detectAdapterModel, waitForExternalAdapters,
} from "./registry.js";
import { resolveNewAgentRunner, agentRunnerAvailability } from "../services/agent-runner-selection.js";
import { SANDBOX_INSTALL_COMMAND } from "@paperclipai/adapter-pi-local";

afterEach(() => vi.unstubAllEnvs());

describe("local OpenAI-compatible endpoint policy", () => {
  it("keeps the pinned Pi install and custom executable path contract", () => {
    expect(SANDBOX_INSTALL_COMMAND).toContain("@earendil-works/pi-coding-agent@0.74.0");
    expect(requireServerAdapter("pi_local").getRuntimeCommandSpec?.({})).toEqual({ command: "pi", detectCommand: "pi", installCommand: SANDBOX_INSTALL_COMMAND });
    expect(requireServerAdapter("pi_local").getRuntimeCommandSpec?.({ command: "/opt/pi/bin/pi" })).toEqual({ command: "/opt/pi/bin/pi", detectCommand: "/opt/pi/bin/pi", installCommand: null });
  });
  it("offers only the builtin local adapter and never loads external adapter packages", async () => {
    await waitForExternalAdapters();
    expect(listServerAdapters().map(adapter => adapter.type)).toEqual(["pi_local"]);
    expect(externalLoad).not.toHaveBeenCalled();
    expect(agentRunnerAvailability("pi_local")).toEqual({ supportedRunners: ["legacy"], defaultRunner: "legacy" });
  });
  it.each(["claude_local", "codex_local", "paperclip_runner", "process", "http", "external_test"])("rejects %s without a process fallback", type => {
    expect(() => requireServerAdapter(type)).toThrow();
    expect(() => getServerAdapter(type)).toThrow();
    expect(() => resolveNewAgentRunner({ adapterType: type })).toThrow();
  });
  it("rejects plugin overrides even if they use the allowed adapter type", () => {
    expect(() => registerServerAdapter({ ...requireServerAdapter("pi_local") })).toThrow();
  });
  it("never discovers vendor models from global Pi or environment configuration", async () => {
    vi.stubEnv("PAPERCLIP_ADAPTER_MODELS", JSON.stringify({ pi_local: [{ id: "openai/cloud-model" }] }));
    expect(await listAdapterModels("pi_local")).toEqual([]);
    expect(await refreshAdapterModels("pi_local")).toEqual([]);
    expect(await detectAdapterModel("pi_local")).toBeNull();
  });
  it("allows an incomplete setup-only draft and requires explicit URL/model for a complete agent", () => {
    expect(resolveNewAgentRunner({ adapterType: "pi_local", setupOnly: true })).toEqual({ adapterType: "pi_local", adapterConfig: {} });
    expect(() => resolveNewAgentRunner({ adapterType: "pi_local" })).toThrow(/URL/);
    expect(() => resolveNewAgentRunner({ adapterType: "pi_local", adapterConfig: { baseUrl: "http://localhost:11434/v1" } })).toThrow(/модел/i);
    expect(resolveNewAgentRunner({ adapterType: "pi_local", adapterConfig: { baseUrl: "http://localhost:11434/v1/", model: "org/qwen" } })).toEqual({ adapterType: "pi_local", adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/org/qwen" } });
  });
  it("refuses the native runner and never translates the local endpoint into a vendor runtime", () => {
    expect(() => resolveNewAgentRunner({ adapterType: "pi_local", runner: "paperclip", adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/qwen" } })).toThrow();
  });
});
