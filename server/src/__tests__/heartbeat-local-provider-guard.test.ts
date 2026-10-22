import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const { resolveRouter, prepareManaged, execute } = vi.hoisted(() => ({
  resolveRouter: vi.fn(() => { throw new Error("Managed router must not be entered"); }),
  prepareManaged: vi.fn(() => { throw new Error("Managed account must not be entered"); }),
  execute: vi.fn(async (_input: { config: Record<string, unknown> }) => ({ exitCode: 0, signal: null, timedOut: false })),
}));
vi.mock("../services/ai-connection-router.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/ai-connection-router.js")>(),
  aiConnectionRouterService: () => ({ resolve: resolveRouter }),
}));
vi.mock("../services/ai-connection-runtime.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/ai-connection-runtime.js")>(),
  prepareManagedAiRuntime: prepareManaged,
}));
vi.mock("@paperclipai/adapter-pi-local/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@paperclipai/adapter-pi-local/server")>(),
  execute,
}));

import { heartbeatService } from "../services/heartbeat.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping local-provider heartbeat guard tests: ${support.reason}`);

describePostgres("heartbeat local-only provider guard", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("heartbeat-local-provider-guard-");
    db = createDb(temporary.connectionString);
    await db.execute(sql`set client_min_messages = warning`);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    await heartbeat.drainActiveRunExecutions();
    await db.execute(sql.raw('TRUNCATE TABLE "companies" CASCADE'));
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await heartbeat?.drainActiveRunExecutions();
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  it.each([
    { name: "old hosted adapter", adapterType: "codex_local" },
    { name: "managed account", runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "responsible_user" } } },
    { name: "managed router", runtimeConfig: { aiConnection: { mode: "router", connectionId: randomUUID() } } },
    { name: "saved managed account", contextSnapshot: { aiConnection: { connectionId: randomUUID(), provider: "openai" } } },
    { name: "saved router selection", contextSnapshot: { aiRouterSelection: { poolId: randomUUID() } } },
    { name: "saved native input", runnerProfileJson: { nativeExecutionInput: { provider: "codex", model: "hosted-model" } } },
    { name: "missing endpoint", adapterConfig: { model: "local/balabol" } },
    { name: "invalid endpoint", adapterConfig: { baseUrl: "https://user:secret@example.test/v1", model: "local/balabol" } },
    { name: "missing model", adapterConfig: { baseUrl: "http://127.0.0.1:11434/v1" } },
  ])("fails $name before resolving accounts or dispatching", async (fixture) => {
    const companyId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    const adapterType = fixture.adapterType ?? "pi_local";
    const adapterConfig = fixture.adapterConfig ?? { baseUrl: "http://127.0.0.1:11434/v1", model: "local/balabol" };
    const runtimeConfig = fixture.runtimeConfig ?? {};
    await db.insert(companies).values({ id: companyId, name: "Сказ", issuePrefix: `L${companyId.slice(0, 6)}`, defaultResponsibleUserId: "local-board" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Сохранённый агент", status: "idle", adapterType, adapterConfig, runtimeConfig });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "local-board",
      contextSnapshot: fixture.contextSnapshot ?? {}, runnerProfileJson: fixture.runnerProfileJson ?? {} });

    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();

    const finished = await heartbeat.getRun(runId);
    expect(finished).toMatchObject({ status: "failed", errorCode: "configuration_incomplete", resultJson: {
      configurationIncomplete: { reason: "local_provider_required" },
      executionRecovery: { providerWorkStarted: false },
    } });
    expect(finished?.error).toContain("Сказ");
    expect(resolveRouter).not.toHaveBeenCalled();
    expect(prepareManaged).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    const [preserved] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(preserved).toMatchObject({ adapterType, adapterConfig, runtimeConfig });
  });

  it("dispatches an explicit corporate endpoint without a managed account", async () => {
    const companyId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    const adapterConfig = { baseUrl: "https://corporate.example.test/v1", model: "local/team/balabol" };
    await db.insert(companies).values({ id: companyId, name: "Сказ", issuePrefix: `L${companyId.slice(0, 6)}`, defaultResponsibleUserId: "local-board" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Локальный агент", status: "idle", adapterType: "pi_local", adapterConfig });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "local-board" });

    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();

    expect(await heartbeat.getRun(runId)).toMatchObject({ status: "succeeded", runtimeMode: "legacy" });
    expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ config: expect.objectContaining(adapterConfig) }));
    expect(resolveRouter).not.toHaveBeenCalled();
    expect(prepareManaged).not.toHaveBeenCalled();
  });
});
