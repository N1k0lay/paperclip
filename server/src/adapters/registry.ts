import { getAdapterSessionManagement } from "@paperclipai/adapter-utils";
import {
  execute, listPiSkills, syncPiSkills, testEnvironment, sessionCodec,
} from "@paperclipai/adapter-pi-local/server";
import { agentConfigurationDoc, SANDBOX_INSTALL_COMMAND } from "@paperclipai/adapter-pi-local";
import { HttpError } from "../errors.js";
import { getDisabledAdapterTypes } from "../services/adapter-plugin-store.js";
import type { ServerAdapterModule } from "./types.js";

const piLocalAdapter: ServerAdapterModule = {
  type: "pi_local",
  runtimeToolDelivery: "environment",
  execute,
  testEnvironment,
  listSkills: listPiSkills,
  syncSkills: syncPiSkills,
  sessionCodec,
  sessionManagement: getAdapterSessionManagement("pi_local") ?? undefined,
  supportsToolRefreshOnResume: true,
  models: [],
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  getRuntimeCommandSpec: (config) => {
    const command = typeof config.command === "string" && config.command.trim() ? config.command.trim() : "pi";
    return { command, detectCommand: command, installCommand: command === "pi" ? SANDBOX_INSTALL_COMMAND : null };
  },
  agentConfigurationDoc,
};

function unavailable(): never {
  throw new HttpError(422, "Сказ поддерживает только локальный или корпоративный OpenAI-совместимый API.");
}

export function findServerAdapter(type: string): ServerAdapterModule | null {
  return type === "pi_local" ? piLocalAdapter : null;
}
export const findActiveServerAdapter = findServerAdapter;

export function requireServerAdapter(type: string): ServerAdapterModule {
  return findServerAdapter(type) ?? unavailable();
}
export const getServerAdapter = requireServerAdapter;

export function listServerAdapters(): ServerAdapterModule[] { return [piLocalAdapter]; }
export function listEnabledServerAdapters(): ServerAdapterModule[] {
  return getDisabledAdapterTypes().includes("pi_local") ? [] : [piLocalAdapter];
}

// Model IDs belong to the configured endpoint, never the host's vendor accounts.
export async function listAdapterModels(_type: string): Promise<Array<{ id: string; label: string }>> { return []; }
export const refreshAdapterModels = listAdapterModels;
export async function detectAdapterModel(_type: string): Promise<{ model: string; provider: string; source: string; candidates?: string[] } | null> { return null; }

// Persisted plugin records stay intact, but this distribution never loads their code.
export async function waitForExternalAdapters(): Promise<void> {}
export function resolveExternalAdapterRegistration(_adapter: ServerAdapterModule): ServerAdapterModule { return unavailable(); }
export function registerServerAdapter(_adapter: ServerAdapterModule): void { unavailable(); }
export function unregisterServerAdapter(_type: string): void {}
export function setOverridePaused(_type: string, _paused: boolean): boolean { return false; }
export function isOverridePaused(_type: string): boolean { return false; }
export function hasActiveAdapterOverride(_type: string): boolean { return false; }
export function getPausedOverrides(): Set<string> { return new Set(); }
