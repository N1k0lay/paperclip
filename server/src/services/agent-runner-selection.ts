import type { Db } from "@paperclipai/db";
import type { AgentRunnerChoice, AgentRunnerAvailability } from "@paperclipai/shared";
import { resolvePiLocalProvider } from "@paperclipai/adapter-pi-local/server";
import { waitForExternalAdapters } from "../adapters/registry.js";
import { forbidden, unprocessable } from "../errors.js";
import { localAgentRunnerTarget } from "../lib/agent-runner-platform.js";

export type RunnerTarget = { driver: string; platform?: string; architecture?: string; libc?: "glibc" | "musl" | "unknown"; glibcVersion?: string };
export const AGENT_RUNNER_SSH_PLATFORM_COMMAND = "uname -s; uname -m; if paperclip_glibc_version=$(getconf GNU_LIBC_VERSION 2>/dev/null) && [ -n \"$paperclip_glibc_version\" ]; then printf 'glibc\\n%s\\n' \"$paperclip_glibc_version\"; else case \"$(ldd --version 2>&1)\" in *musl*) printf 'musl\\n' ;; *) printf 'unknown\\n' ;; esac; fi";
export interface AgentRunnerSelection {
  adapterType?: string | null;
  adapterConfig?: Record<string, unknown>;
  runner?: AgentRunnerChoice;
  target?: RunnerTarget;
  /** Server-owned inactive setup drafts may precede model selection. Never use for a hire or run. */
  setupOnly?: boolean;
}

export function agentRunnerAvailability(_harness: string, _target?: RunnerTarget): AgentRunnerAvailability {
  return { supportedRunners: ["legacy"], defaultRunner: "legacy" };
}

export function resolveNewAgentRunner(input: AgentRunnerSelection): { adapterType: string; adapterConfig: Record<string, unknown> } {
  if (input.adapterType !== "pi_local") throw unprocessable("Выберите локальный или корпоративный OpenAI-совместимый API.");
  if (input.runner === "paperclip") throw unprocessable("Локальный API использует стандартный запуск Pi.");
  const config = { ...input.adapterConfig };
  if (input.setupOnly) return { adapterType: "pi_local", adapterConfig: config };
  try {
    const provider = resolvePiLocalProvider(config);
    if (!provider) throw new Error("Укажите URL локального или корпоративного API.");
    return { adapterType: "pi_local", adapterConfig: { ...config, baseUrl: provider.baseUrl, model: `local/${provider.modelId}` } };
  } catch (error) {
    throw unprocessable(error instanceof Error ? error.message : "Некорректная настройка локального API.");
  }
}

export async function resolveNewAgentRunnerForCompany(_db: Db, _companyId: string, input: AgentRunnerSelection & { defaultEnvironmentId?: string | null }) {
  return resolveNewAgentRunner(input);
}

export async function resolveAgentRunnerTargetForCompany(db: Db, companyId: string, defaultEnvironmentId?: string | null): Promise<RunnerTarget> {
  await waitForExternalAdapters();
  const { instanceSettingsService } = await import("./instance-settings.js");
  const { environmentService } = await import("./environments.js");
  const settings = await instanceSettingsService(db).get();
  const envs = environmentService(db);
  const environmentId = defaultEnvironmentId ?? settings.defaultEnvironmentId;
  let environment = environmentId ? await envs.getById(environmentId) : null;
  if (settings.experimental?.enableManagedSandboxOnly && (!environment || environment.driver === "local")) {
    environment = await envs.findManagedSandboxEnvironment(companyId);
    if (!environment) throw unprocessable("The managed sandbox is unavailable. Restore Paperclip Computer and retry.", { code: "managed_sandbox_unavailable" });
  }
  if (settings.general?.executionMode === "kubernetes") {
    environment = await envs.findKubernetesEnvironment(companyId);
    if (!environment) return { driver: "sandbox" };
  }
  if (environmentId && !environment) throw unprocessable("Environment not found.");
  if (environment) {
    const boundCompanyIds = await envs.listBoundCompanyIds(environment.id);
    if (boundCompanyIds.length > 0 && !boundCompanyIds.includes(companyId)) throw forbidden("The selected environment belongs to another company.", { code: "environment_company_mismatch" });
    if (environment.status === "archived") throw unprocessable("Environment is archived.");
    if (environment.driver === "sandbox" && environment.config?.provider === "fake") throw unprocessable("The fake sandbox provider cannot execute runs.");
  }
  const driver = environment?.driver ?? "local";
  let target: RunnerTarget = driver === "local" ? localAgentRunnerTarget()
    : { driver };
  if (driver === "sandbox" && environment) {
    const { readSandboxPlatformQualification } = await import("./environment-probe.js");
    const qualified = await readSandboxPlatformQualification(db, environment, companyId);
    if (qualified) target = { driver, ...qualified };
  }
  return target;
}
