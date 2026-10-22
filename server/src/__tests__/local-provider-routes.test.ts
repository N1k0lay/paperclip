import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
const { loadPackage, verifyKey } = vi.hoisted(() => ({ loadPackage: vi.fn(), verifyKey: vi.fn() }));
vi.mock("../adapters/plugin-loader.js", () => ({ loadExternalAdapterPackage: loadPackage, getUiParserSource: vi.fn(), getOrExtractUiParserSource: vi.fn(), reloadExternalAdapter: loadPackage }));
vi.mock("../services/adapter-plugin-store.js", () => ({ listAdapterPlugins: () => [], getDisabledAdapterTypes: () => [], getAdapterPluginByType: () => undefined }));
vi.mock("../services/ai-api-key-test.js", () => ({ validateAiApiKey: verifyKey }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({}) }));
vi.mock("../services/local-ai-login.js", () => ({ localAiLoginService: () => ({}) }));
vi.mock("../services/ai-connection-router.js", () => ({ aiConnectionRouterService: () => ({}) }));
import { adapterRoutes } from "../routes/adapters.js";
import { aiConnectionRoutes } from "../routes/ai-connections.js";

function app(local = true, resolveRunnerTarget = vi.fn()) {
  const application = express();
  application.use(express.json());
  application.use((req, _res, next) => {
    req.actor = { type: "board", userId: "local-board", source: local ? "local_implicit" : "session", isInstanceAdmin: local, companyIds: ["company-1"] } as never;
    next();
  });
  application.use("/api", adapterRoutes({ resolveRunnerTarget }));
  application.use("/api", aiConnectionRoutes({} as never));
  application.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ error: error.message }));
  return application;
}

describe("local-only provider API", () => {
  it("advertises only local Pi with the legacy runner", async () => {
    const response = await request(app()).get("/api/adapters");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject([{ type: "pi_local", source: "builtin", defaultRunner: "legacy", supportedRunners: ["legacy"] }]);
    expect(response.body).toHaveLength(1);
  });
  it("checks company access before resolving or probing its environment", async () => {
    const resolve = vi.fn();
    const response = await request(app(false, resolve)).get("/api/adapters?companyId=foreign-company");
    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });
  it("keeps external adapter changes unavailable to non-admin members", async () => {
    const response = await request(app(false)).post("/api/adapters/install").send({ packageName: "external" });
    expect(response.status).toBe(403);
    expect(loadPackage).not.toHaveBeenCalled();
  });
  it.each(["/api/adapters/install", "/api/adapters/cloud/reload", "/api/adapters/cloud/reinstall"])("blocks package execution at %s before loading external code", async url => {
    const response = await request(app()).post(url).send({ packageName: "external-cloud-adapter" });
    expect(response.status).toBe(403);
    expect(loadPackage).not.toHaveBeenCalled();
  });
  it.each(["/api/companies/company-1/ai-connections", "/api/companies/company-1/ai-connections/local/attempts", "/api/companies/company-1/ai-connection-pools"])("blocks direct cloud provider authentication at %s", async url => {
    const response = await request(app()).post(url).send({ provider: "openai", apiKey: "fixture-key" });
    expect(response.status).toBe(403);
    expect(verifyKey).not.toHaveBeenCalled();
  });
  it("blocks outbound cloud usage probes", async () => {
    const response = await request(app()).get("/api/companies/company-1/ai-connections/fixture/usage");
    expect(response.status).toBe(403);
    expect(verifyKey).not.toHaveBeenCalled();
  });
});
