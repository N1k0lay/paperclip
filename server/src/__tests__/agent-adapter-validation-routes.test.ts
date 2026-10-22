import express from "express";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ServerAdapterModule } from "../adapters/index.js";

const mockAgentService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  getConfigRevision: vi.fn(),
  rollbackConfigRevision: vi.fn(),
  update: vi.fn(),
}));

const mockAdapterPluginStore = vi.hoisted(() => ({
  getDisabledAdapterTypes: vi.fn<() => string[]>(() => []),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  hasPermission: vi.fn(),
  ensureMembership: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
  resolveAdapterConfigForRuntime: vi.fn(async (_companyId: string, config: Record<string, unknown>) => ({ config })),
  syncEnvBindingsForTarget: vi.fn(),
}));

const mockAgentInstructionsService = vi.hoisted(() => ({
  materializeManagedBundle: vi.fn(),
  getBundle: vi.fn(),
  readFile: vi.fn(),
  updateBundle: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  exportFiles: vi.fn(),
  ensureManagedBundle: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  cancelActiveForAgent: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
}));

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(async () => ({ defaultEnvironmentId: null })),
  getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
  getExperimental: vi.fn(async (): Promise<{ enableNativeRunner: boolean; enableOpenAiDot?: boolean }> => ({ enableNativeRunner: false })),
}));

const mockManagedAgentProfileService = vi.hoisted(() => ({
  requireQualified: vi.fn(),
}));

const mockRemoteAgentProfileService = vi.hoisted(() => ({
  requireQualified: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => mockAgentInstructionsService,
  accessService: () => mockAccessService,
  approvalService: () => mockApprovalService,
  builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
  companySkillService: () => mockCompanySkillService,
  budgetService: () => mockBudgetService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => ({}),
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => ({}),
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => mockInstanceSettingsService,
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/managed-agent-profiles.js", () => ({
  managedAgentProfileService: () => mockManagedAgentProfileService,
}));

vi.mock("../services/remote-agent-profiles.js", () => ({
  remoteAgentProfileService: () => mockRemoteAgentProfileService,
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentInstructionsService: () => mockAgentInstructionsService,
    accessService: () => mockAccessService,
    approvalService: () => mockApprovalService,
    builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
    companySkillService: () => mockCompanySkillService,
    budgetService: () => mockBudgetService,
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => mockIssueApprovalService,
    issueService: () => ({}),
    logActivity: mockLogActivity,
    secretService: () => mockSecretService,
    syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
    workspaceOperationService: () => ({}),
  }));

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));

  vi.doMock("../services/secrets.js", () => ({
    secretService: () => mockSecretService,
  }));

  vi.doMock("../services/managed-agent-profiles.js", () => ({
    managedAgentProfileService: () => mockManagedAgentProfileService,
  }));

  vi.doMock("../services/remote-agent-profiles.js", () => ({
    remoteAgentProfileService: () => mockRemoteAgentProfileService,
  }));

  // The adapter registry reads the disabled set from this store. Mock it so a
  // test can declare an adapter disabled without writing to the real
  // ~/.paperclip/adapter-settings.json.
  vi.doMock("../services/adapter-plugin-store.js", () => ({
    getDisabledAdapterTypes: mockAdapterPluginStore.getDisabledAdapterTypes,
    isAdapterDisabled: (type: string) =>
      mockAdapterPluginStore.getDisabledAdapterTypes().includes(type),
    listAdapterPlugins: () => [],
    getAdapterPluginByType: () => undefined,
    setAdapterDisabled: vi.fn(),
  }));
}

const externalAdapter: ServerAdapterModule = {
  type: "external_test",
  execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
  testEnvironment: async () => ({
    adapterType: "external_test",
    status: "pass",
    checks: [],
    testedAt: new Date(0).toISOString(),
  }),
};

const missingAdapterType = "missing_adapter_validation_test";

async function createApp(actorOverride: Record<string, unknown> = {}) {
  const [{ agentRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
      ...actorOverride,
    };
    next();
  });
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [
          {
            id: "company-1",
            requireBoardApprovalForNewAgents: false,
          },
        ]),
      })),
    })),
  };
  app.use("/api", agentRoutes(db as any));
  app.use(errorHandler);
  return app;
}

async function requestApp(
  app: express.Express,
  buildRequest: (baseUrl: string) => request.Test,
) {
  const { createServer } = await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a TCP port");
    }
    return await buildRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

async function unregisterTestAdapter(type: string) {
  const { unregisterServerAdapter } = await import("../adapters/index.js");
  unregisterServerAdapter(type);
}

describe("agent routes adapter validation", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock("../routes/agents.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.doUnmock("../routes/agents.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockAdapterPluginStore.getDisabledAdapterTypes.mockReturnValue([]);
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockResolvedValue([]);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      reason: "allow_explicit_grant",
      explanation: "Allowed by test grant",
    });
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
    mockSecretService.syncEnvBindingsForTarget.mockResolvedValue(undefined);
    mockInstanceSettingsService.getExperimental.mockResolvedValue({ enableNativeRunner: false });
    mockManagedAgentProfileService.requireQualified.mockResolvedValue({
      id: "managed-primary",
      companyId: "company-1",
      enabled: true,
    });
    mockRemoteAgentProfileService.requireQualified.mockResolvedValue({
      id: "agentcore-primary",
      companyId: "company-1",
      enabled: true,
    });
    mockAgentInstructionsService.materializeManagedBundle.mockImplementation(async (agent: { adapterConfig: unknown }) => ({
      adapterConfig: agent.adapterConfig,
    }));
    mockAgentService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      id: String(input.id ?? "11111111-1111-4111-8111-111111111111"),
      companyId: "company-1",
      name: String(input.name ?? "Agent"),
      urlKey: "agent",
      role: String(input.role ?? "general"),
      title: null,
      icon: null,
      status: "idle",
      reportsTo: null,
      capabilities: null,
      adapterType: String(input.adapterType ?? "process"),
      adapterConfig: (input.adapterConfig as Record<string, unknown> | undefined) ?? {},
      runtimeConfig: (input.runtimeConfig as Record<string, unknown> | undefined) ?? {},
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: false },
      lastHeartbeatAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    mockAgentService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      name: "Codex",
      urlKey: "codex",
      role: "engineer",
      title: null,
      icon: null,
      status: "idle",
      reportsTo: null,
      capabilities: null,
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: false },
      lastHeartbeatAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockAgentService.getConfigRevision.mockResolvedValue(null);
    mockAgentService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...(await mockAgentService.getById()),
      ...patch,
    }));
    await unregisterTestAdapter("external_test");
    await unregisterTestAdapter(missingAdapterType);
  });

  afterEach(async () => {
    await unregisterTestAdapter("external_test");
    await unregisterTestAdapter(missingAdapterType);
  });

  it("rejects unknown adapter types even when schema accepts arbitrary strings", async () => {
    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/agents")
        .send({
          name: "Missing Adapter",
          adapterType: missingAdapterType,
        }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(String(res.body.error ?? res.body.message ?? "")).toContain("OpenAI-совместимый API");
  });

  it.each(["auto", "legacy"] as const)("creates Pi through the public route with %s selection and the experimental flag off", async runner => {
    const app = await createApp();
    const response = await requestApp(app, baseUrl => request(baseUrl).post("/api/companies/company-1/agents").send({
      name: "Pi", adapterType: "pi_local", runner, adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "org/qwen" },
    }));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockAgentService.create.mock.calls.at(-1)?.[1]).toMatchObject({ adapterType: "pi_local", adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/org/qwen" } });
  });

  it("allows model-free Pi only as an inactive setup draft", async () => {
    const selection = await import("../services/agent-runner-selection.js");
    vi.spyOn(selection, "resolveNewAgentRunnerForCompany").mockImplementation(async (_db, _companyId, input) =>
      selection.resolveNewAgentRunner({ ...input, target: { driver: "local", platform: "darwin", architecture: "arm64" } }));
    const originalCreate = mockAgentService.create.getMockImplementation()!;
    mockAgentService.create.mockImplementation(async (...args) => ({ ...await originalCreate(...args), lifecycleHolds: ["setup"] }));
    const app = await createApp();
    const input = { name: "Pi draft", adapterType: "pi_local", adapterConfig: {} };
    const draft = await requestApp(app, baseUrl => request(baseUrl).post("/api/companies/company-1/agents")
      .send({ ...input, setupId: "00000000-0000-4000-8000-000000000092" }));
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(mockAgentService.create.mock.calls.at(-1)?.[1]).toMatchObject({ adapterType: "pi_local", adapterConfig: {} });
    expect(mockAgentService.create.mock.calls.at(-1)?.[2]).toMatchObject({ setupOnly: true, runnerResolved: true });
    mockAgentService.create.mockClear();
    const active = await requestApp(app, baseUrl => request(baseUrl).post("/api/companies/company-1/agents")
      .send({ ...input, setupOnly: true }));
    expect(active.status).toBe(422);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("clears a saved connection router when Pi switches to an explicit local endpoint", async () => {
    const existing = await mockAgentService.getById();
    mockAgentService.getById.mockResolvedValue({ ...existing, adapterType: "pi_local",
      adapterConfig: { model: "openrouter/qwen" },
      runtimeConfig: { heartbeat: { enabled: false }, aiConnection: { mode: "router", connectionId: "22222222-2222-4222-8222-222222222222" } },
    });
    const app = await createApp();
    const response = await requestApp(app, baseUrl => request(baseUrl)
      .patch(`/api/agents/${existing.id}`).send({ runner: "legacy", replaceAdapterConfig: true,
        adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/qwen" },
        runtimeConfig: { heartbeat: { enabled: false } },
      }));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(mockAgentService.update.mock.calls.at(-1)?.[1]).toMatchObject({ runtimeConfig: { heartbeat: { enabled: false } } });
    expect(mockAgentService.update.mock.calls.at(-1)?.[1].runtimeConfig.aiConnection).toBeUndefined();
  });

  it("keeps an existing paperclip_runner agent editable after the flag is disabled", async () => {
    const existing = await mockAgentService.getById();
    mockAgentService.getById.mockResolvedValue({
      ...existing,
      adapterType: "paperclip_runner",
      adapterConfig: { provider: "codex" },
    });
    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .patch("/api/agents/11111111-1111-4111-8111-111111111111")
        .send({ name: "Native Codex (recorded)" }),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledOnce();
  });
  it.each(["claude_local", "codex_local", "paperclip_runner", "process"])("local-only policy rejects creating %s without changing records", async adapterType => {
    const app = await createApp();
    const result = await requestApp(app, baseUrl => request(baseUrl).post("/api/companies/company-1/agents").send({ name: "Blocked", adapterType, adapterConfig: {} }));
    expect(result.status).toBe(422);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("local-only policy rejects cloud account bindings for a local endpoint", async () => {
    const app = await createApp();
    const result = await requestApp(app, baseUrl => request(baseUrl).post("/api/companies/company-1/agents").send({
      name: "Blocked", adapterType: "pi_local", runner: "legacy", adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/qwen" },
      runtimeConfig: { aiConnection: { mode: "responsible_user", provider: "openai", method: "api_key" } },
    }));
    expect(result.status).toBe(422);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

});

vi.mock("../services/agent-lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/agent-lifecycle.js")>();
  return { ...actual, createAgentLifecycle: () => ({
    requestHire: (...args: unknown[]) => mockAgentService.create(...args),
  }) };

});
