// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { buildClaudeLocalConfig } from "../../../packages/adapters/claude-local/src/ui/build-config";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import type { LocalAiLoginStatus } from "@paperclipai/shared";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted so vi.mock factories can close over them) ----------------

// The company list is keyed by account, so it holds until the session query
// *succeeds*. A seeded entry is stale under the test client and refetches, so
// the refetch has to answer too — otherwise the identity errors and the list
// never runs.
const mockAdaptersApi = vi.hoisted(() => ({ list: vi.fn(async (_context?: { companyId: string; environmentId?: string | null }) => [] as import("../api/adapters").AdapterInfo[]) }));
vi.mock("../api/adapters", () => ({ adaptersApi: mockAdaptersApi }));

function setupAdapterInfo(input: Pick<import("../api/adapters").AdapterInfo, "type"> & Partial<import("../api/adapters").AdapterInfo>): import("../api/adapters").AdapterInfo {
  return { label: input.type, source: "builtin", modelsCount: 0, loaded: true, disabled: false,
    capabilities: { supportsInstructionsBundle: true, supportsSkills: true, supportsLocalAgentJwt: true,
      requiresMaterializedRuntimeSkills: false, supportsAcp: true }, ...input };
}

const mockAuthApi = vi.hoisted(() => ({ getSession: vi.fn() }));
const localHealth = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/health", () => ({ healthApi: localHealth }));
const managedApi = vi.hoisted(() => ({
  list: vi.fn(async () => ({ currentUserId: "user-1", connections: [] })),
  startLocalLogin: vi.fn(async () => ({ sessionId: "local-attempt", expiresAt: "2099-01-01T00:00:00Z" })),
  submitLocalLoginCode: vi.fn(async () => ({ ok: true })),
  checkLocalLogin: vi.fn(async (): Promise<LocalAiLoginStatus> => ({ status: "sign_in_required" })),
  cancelLocalLogin: vi.fn(async () => ({})),
  connectLocal: vi.fn(async () => ({ connectionId: "local-connection", grantId: "local-grant" })),
  create: vi.fn(async () => ({ connectionId: "managed-connection", grantId: "managed-grant" })),
}));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: managedApi }));
// Keep the wizard tests focused on binding/model/creation boundaries. The
// connection component has its own tests; the ordinary-install UI canary
// exercises its real token storage and default selection.
vi.mock("./ai-connections/AiConnectionField", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai-connections/AiConnectionField")>();
  return { ...actual, AiConnectionField: (props: { environmentId?: string; onChange: (value: import("@paperclipai/shared").AiConnectionBinding) => void }) => (
    <button data-environment={props.environmentId} onClick={() => props.onChange({ provider: "github", method: "api_key", mode: "responsible_user" })}>Use saved Copilot connection</button>
  ) };
});
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, authApi: { ...actual.authApi, getSession: mockAuthApi.getSession } };
});

const mockDialog = vi.hoisted(() => ({
  onboardingOpen: true,
  onboardingOptions: {} as { initialStep?: number; companyId?: string },
  closeOnboarding: vi.fn(),
  onboardingRouteDismissed: false,
  setOnboardingRouteDismissed: vi.fn(),
}));

const mockCompany = vi.hoisted(() => ({
  companies: [] as Array<{ id: string; name: string; issuePrefix: string }>,
  setSelectedCompanyId: vi.fn(),
  loading: false,
  error: null as Error | null,
}));

const mockCompaniesApi = vi.hoisted(() => ({
  detachInflightList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  // The gate fetches the list itself now, rather than reading the shared
  // cache, so ownership cases are driven from here. `mockCompany.companies`
  // below still feeds the *inner* wizard, which is a different question.
  list: vi.fn(),
}));
const mockGoalsApi = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(async () => []),
}));
const mockAgentsApi = vi.hoisted(() => ({
  create: vi.fn(async (_company: string, input: Record<string, unknown>) => ({ ...input, id: input.setupId, pauseReason: "setup" })),
  get: vi.fn(),
  update: vi.fn(async (_id: string, input: Record<string, unknown>) => input),
  adapterModels: vi.fn(async () => [] as Array<{ id: string; label: string }>),
  testEnvironment: vi.fn(
    async (): Promise<import("@paperclipai/shared").AdapterEnvironmentTestResult> => ({
      adapterType: "claude_local",
      status: "pass",
      checks: [],
      testedAt: new Date().toISOString(),
    }),
  ),
  hire: vi.fn(async () => ({ agent: { id: "agent-1" }, approval: null })),
  // The hire step lists the company's agents first and adopts one that already
  // carries the typed name on the same source, so a wizard that reopens on the
  // agent step cannot hire "Ada 2". Empty by default: the company is new.
  list: vi.fn(async () => [] as Array<{ id: string; name: string; adapterType: string; adapterConfig?: Record<string, unknown> }>),
  instructionsBundle: vi.fn(async () => ({ entryFile: "AGENTS.md" })),
  saveInstructionsFile: vi.fn(async () => ({})),
  // No default implementation: the top-level `beforeEach` sets the "no
  // stored value" 404 rejection, using the real `ApiError` class the code
  // under test checks with `instanceof`.
  getClaudeOAuthTokenStatus: vi.fn(),
  getAdapterAuthSignal: vi.fn(
    async (): Promise<import("@paperclipai/shared").AdapterAuthSignalResponse> => ({
      status: "present",
    }),
  ),
  // The sign-in routes. The connect step's Connect button starts a login rather
  // than hiring when the signal says the source has no credential, so the two
  // login shapes need enough of a server to reach the state the step is about:
  // a session that is running, and a prompt to show for it.
  startClaudeSetupTokenLogin: vi.fn(async () => ({
    sessionId: "claude-session-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  })),
  getClaudeSetupTokenLoginStatus: vi.fn(async () => ({
    sessionId: "claude-session-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  })),
  getClaudeSetupTokenLoginPrompt: vi.fn(async () => ({
    authorizationUrl: "https://claude.ai/oauth/authorize?code=true",
    transportAdvisory: null,
  })),
  cancelClaudeSetupTokenLogin: vi.fn(async () => ({})),
  submitClaudeSetupTokenBrowserCode: vi.fn(async () => ({})),
  completeClaudeSetupTokenLogin: vi.fn(async () => ({ storedSessionId: "stored-1" })),
  startAdapterAuthLogin: vi.fn(async () => ({
    sessionId: "codex-session-1",
    status: "pending",
  })),
  getAdapterAuthLoginStatus: vi.fn(async () => ({
    sessionId: "codex-session-1",
    status: "pending",
    prompt: { url: "https://auth.openai.com/codex/device", code: "Q2RJ-E1YIF" },
  })),
  cancelAdapterAuthLogin: vi.fn(async () => ({})),
  // No default implementation: the top-level `beforeEach` sets the "no active
  // session" 404 rejection, matching the real route.
  getActiveAdapterAuthLoginSession: vi.fn(),
  getActiveClaudeSetupTokenLoginSession: vi.fn(),
}));
// The adapter registry mock below always returns this function, so a test
// can shape the built adapter config (e.g. a configured ANTHROPIC_API_KEY)
// without a real adapter package.
const mockAdapterBuild = vi.hoisted(() => ({
  buildAdapterConfig: vi.fn((_values?: CreateConfigValues) => ({}) as Record<string, unknown>),
}));
// The Connect path loads environment settings before probing; without these
// the probe dies on "Could not load environment settings" and the hire never
// runs — which reads as a mysterious 0-call assertion, not an error.
const mockEnvironmentsApi = vi.hoisted(() => ({
  probe: vi.fn(async (): Promise<import("@paperclipai/shared").EnvironmentProbeResult> => ({ ok: true, driver: "sandbox", summary: "Measured image", details: { platformQualificationRecorded: true, leaseId: "platform-lease" } })),
  list: vi.fn(async () => [] as Array<Record<string, unknown>>),
  capabilities: vi.fn(
    async (): Promise<import("@paperclipai/shared").EnvironmentCapabilities> =>
      (await import("@paperclipai/shared")).getEnvironmentCapabilities([]),
  ),
}));
const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(async () => ({ defaultEnvironmentId: null as string | null })),
  getExperimental: vi.fn(async (): Promise<{ enableManagedSandboxOnly: boolean; enableNativeRunner?: boolean }> => ({ enableManagedSandboxOnly: false })),
}));
const mockApprovalsApi = vi.hoisted(() => ({
  create: vi.fn(),
}));
const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  removeUserSecretDefinition: vi.fn(),
  listMyUserSecrets: vi.fn(),
  createUserSecretDefinition: vi.fn(),
  createMyUserSecret: vi.fn(),
  rotateMyUserSecret: vi.fn(),
}));
const mockIssuesApi = vi.hoisted(() => ({
  create: vi.fn(),
}));
const mockProjectsApi = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(async () => []),
}));

// The real adapter registry eagerly imports every adapter package. The
// model/harness picker internals are out of scope here, so stub the adapter
// layer entirely and drive it through this knob.
const mockAdapterRegistry = vi.hoisted(() => ({
  list: [] as Array<{ type: string; recommended?: boolean }>,
  disabled: new Set<string>(),
}));

const mockRouterState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: mockRouterState.pathname, search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));
vi.mock("../context/DialogContext", () => ({
  useDialog: () => mockDialog,
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompany,
}));
vi.mock("../api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("../api/goals", () => ({ goalsApi: mockGoalsApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/approvals", () => ({ approvalsApi: mockApprovalsApi }));
vi.mock("../api/secrets", () => ({ secretsApi: mockSecretsApi }));
vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../api/projects", () => ({ projectsApi: mockProjectsApi }));
vi.mock("../api/environments", () => ({ environmentsApi: mockEnvironmentsApi }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));
vi.mock("../adapters", () => ({
  listUIAdapters: () => mockAdapterRegistry.list,
  getUIAdapter: () => ({ buildAdapterConfig: mockAdapterBuild.buildAdapterConfig }),
}));
vi.mock("../adapters/metadata", () => ({ isVisualAdapterChoice: () => true }));
vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterDisplay: (type: string) => ({
    type,
    // Mirrors the real registry, where these two and only these two are
    // `recommended`. A blanket `false` used to be harmless because every adapter
    // then sat in the "Advanced settings" disclosure and was reachable anyway;
    // with the step down to a tile row built from this flag, it made that row
    // empty in every test and hid the surface under it.
    recommended: type === "claude_local" || type === "codex_local" || mockAdapterRegistry.list.some(entry => entry.type === type && entry.recommended),
    label: type,
    description: "",
    icon: () => null,
  }),
  getAdapterLabel: (type: string) => type,
  getAdapterLabels: () => ({}) as Record<string, string>,
  isKnownAdapterType: () => true,
}));
vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => mockAdapterRegistry.disabled,
  // Added by #11371's adapter snap. A module mock replaces the whole module,
  // so every export the component reaches for has to be here — omitting one
  // makes it undefined and the call throws.
  useAdapterRegistryLoaded: () => true,
}));
// Adapters with a declared login capability, mirroring the real registry:
// `claude_local` and `codex_local` both support a sandbox login, and every
// other type has none, matching the real `useAdapterCapabilities` fallback for
// an unlisted type.
//
// The panel modes are the real ones rather than one mode for both. They used to
// be, back when nothing outside the panel dispatcher read them. The connect
// step reads them now — the two logins end in different places, so its button
// waits differently for each — and a mock that called Claude's login
// `displayed_code` would have the step testing the wrong half of that.
// Reconcile with KNOWN_DEFAULTS in `adapters/use-adapter-capabilities.ts`.
const ADAPTER_LOGIN_MODES: Record<string, "displayed_code" | "submitted_browser_code"> = {
  claude_local: "submitted_browser_code",
  codex_local: "displayed_code",
};
vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => (type: string) => ({
    supportsInstructionsBundle: false,
    supportsSkills: false,
    supportsLocalAgentJwt: false,
    requiresMaterializedRuntimeSkills: false,
    login: ADAPTER_LOGIN_MODES[type]
      ? { panelMode: ADAPTER_LOGIN_MODES[type]!, timeoutPolicy: "fixed" as const }
      : undefined,
  }),
}));
// Animation / canvas-ish children that add nothing to the logic under test.
vi.mock("./AsciiArtAnimation", () => ({ AsciiArtAnimation: () => null }));
vi.mock("./AgentCapsule", () => ({ AgentCapsule: () => null }));

import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { ADAPTER_AUTH_MISSING_CHECK_CODE, getEnvironmentCapabilities } from "@paperclipai/shared";
import { CLAUDE_OAUTH_TOKEN_ENV_KEY } from "./environment-variables-editor/model";
import { ONBOARDING_STORAGE_KEY, OnboardingWizard } from "./OnboardingWizard";
import { CONNECTED_HOLD_MS } from "./onboarding/onboarding-motion";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** React tracks input value on the DOM node; set it the way React will see. */
function setControlledValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function renderWizardView(root: ReturnType<typeof createRoot>, queryClient: QueryClient) {
  return act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <OnboardingWizard />
      </QueryClientProvider>,
    );
  });
}

const SESSION_USER_ID = "user-b";

function render(staleTime = 0) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  });
  // The company list is keyed by account, so it stays disabled until the
  // session is known. Seeding it is how these tests say "signed in as B".
  queryClient.setQueryData(queryKeys.auth.session, {
    session: { id: "session-b", userId: SESSION_USER_ID },
    user: { id: SESSION_USER_ID, name: "B", email: "b@example.com", image: null },
  });
  return { container, root, queryClient };
}

/**
 * Press the first model-source tile.
 *
 * By `aria-checked` rather than by label: the display registry is mocked in this
 * suite, so a tile reads "claude_localSubscription" rather than "Claude Code",
 * and a test that selected on the visible name would be asserting the mock.
 *
 * The connect step arrives with nothing chosen, so this is what opens the input
 * surface and lets the step advance.
 */
async function pickFirstSource(
  click: (match: (text: string) => boolean) => Promise<void>,
): Promise<void> {
  const tile = [...document.body.querySelectorAll("button[aria-checked]")][0];
  const label = tile?.textContent?.trim() ?? "";
  await click((text) => text === label);
}

/**
 * The arc footer's primary button, whatever this step calls it.
 *
 * Step 4 calls it "Connect", because there it starts a sign-in rather than
 * simply advancing; every other arc step calls it "Next". These tests are about
 * what the press does, not what it reads, so they match either — restating the
 * label at twenty call sites would make a copy change look like a behaviour
 * regression. The label itself is pinned once, in the step test that is about
 * the label.
 */
function isArcPrimary(text: string): boolean {
  return text.startsWith("Next") || text.startsWith("Connect");
}

describe("OnboardingWizard restore-gate (stale localStorage across accounts)", () => {
  beforeEach(() => {
    mockAdaptersApi.list.mockReset().mockResolvedValue([]);
    mockEnvironmentsApi.probe.mockReset().mockResolvedValue({ ok: true, driver: "sandbox", summary: "Measured image", details: { platformQualificationRecorded: true, leaseId: "platform-lease" } });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableManagedSandboxOnly: false });
    localHealth.get.mockResolvedValue({ deploymentMode: "authenticated" });
    managedApi.checkLocalLogin.mockReset().mockResolvedValue({
      status: "sign_in_required",
      authorizationUrl: "https://claude.ai/oauth/authorize?code=true",
      code: "TEST-CODE",
    });
    managedApi.connectLocal.mockReset().mockResolvedValue({ connectionId: "local-connection", grantId: "local-grant" });
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-b", userId: SESSION_USER_ID },
      user: { id: SESSION_USER_ID, name: "B", email: "b@example.com", image: null },
    });
    mockSecretsApi.list.mockResolvedValue([]);
    mockSecretsApi.listMyUserSecrets.mockResolvedValue([]);
    mockSecretsApi.removeUserSecretDefinition.mockResolvedValue({ ok: true });
    window.localStorage.clear();
    mockRouterState.pathname = "/";
    mockDialog.onboardingOpen = true;
    mockDialog.onboardingOptions = {};
    mockDialog.onboardingRouteDismissed = false;
    mockCompany.companies = [];
    mockCompany.loading = false;
    mockCompany.error = null;
    mockCompaniesApi.list.mockResolvedValue([]);
    mockAdapterRegistry.list = [];
    mockAdapterRegistry.disabled = new Set<string>();
    mockAdaptersApi.list.mockReset().mockResolvedValue(["claude_local", "codex_local"].map(type => setupAdapterInfo({ type, loaded: true, disabled: false, supportedRunners: ["paperclip", "legacy"], defaultRunner: "legacy" })));
    mockAdapterBuild.buildAdapterConfig.mockReset();
    mockAdapterBuild.buildAdapterConfig.mockReturnValue({});
    // Default: no stored Claude login for the owner. The route returns a
    // fixed 404 for a missing value, so the client treats a real `ApiError`
    // with that status as "no stored value" rather than a hard failure.
    mockAgentsApi.getClaudeOAuthTokenStatus.mockReset();
    mockAgentsApi.getClaudeOAuthTokenStatus.mockRejectedValue(
      new ApiError("Not found", 404, null),
    );
    // Default: no active login session for the caller. A resume test
    // overrides this with a resolved session body.
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockReset();
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockRejectedValue(
      new ApiError("Not found", 404, null),
    );
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockReset();
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockRejectedValue(
      new ApiError("Not found", 404, null),
    );
    // Reset to each mock's original default. `mockResolvedValue` /
    // `mockReturnValue` overrides a mock's implementation permanently — it
    // is not undone by `afterEach`'s `vi.clearAllMocks()`, which only clears
    // call history — so a test that customizes one of these must not leak
    // its override into the next test.
    mockAgentsApi.testEnvironment.mockReset();
    mockAgentsApi.adapterModels.mockReset().mockResolvedValue([]);
    mockAgentsApi.testEnvironment.mockResolvedValue({
      adapterType: "claude_local",
      status: "pass" as const,
      checks: [],
      testedAt: new Date().toISOString(),
    });
    mockAgentsApi.hire.mockReset();
    mockAgentsApi.list.mockReset().mockResolvedValue([]);
    mockAgentsApi.create.mockReset().mockImplementation(async (_company, input) => ({ ...input, id: input.setupId, pauseReason: "setup" }));
    mockAgentsApi.hire.mockResolvedValue({ agent: { id: "agent-1" }, approval: null });
    mockCompaniesApi.create.mockResolvedValue({
      id: "created",
      name: "Created Co",
      issuePrefix: "CRE",
    });
    mockCompaniesApi.update.mockResolvedValue({
      id: "c1",
      name: "Acme Rockets",
      issuePrefix: "PAP",
    });
    mockGoalsApi.create.mockResolvedValue({ id: "goal-1" });
    mockGoalsApi.list.mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });


  describe("first-company local API setup", () => {
    async function openLocal() {
      mockAdapterRegistry.list = [{ type: "pi_local" }, { type: "claude_local" }, { type: "codex_local" }];
      mockAdaptersApi.list.mockResolvedValue([setupAdapterInfo({ type: "pi_local", loaded: true, disabled: false, supportedRunners: ["legacy"], defaultRunner: "legacy" })]);
      mockSecretsApi.createUserSecretDefinition.mockResolvedValue({ id: "local-key-definition" });
      mockSecretsApi.createMyUserSecret.mockResolvedValue({ id: "local-key" });
      mockProjectsApi.create.mockResolvedValue({ id: "onboarding-project" });
      mockIssuesApi.create.mockResolvedValue({ id: "first-task", identifier: "CRE-1" });
      const handles = render();
      await renderWizardView(handles.root, handles.queryClient);
      await flushReact();
      const click = async (text: string) => {
        const button = [...document.body.querySelectorAll("button")].find(node => node.textContent?.trim().startsWith(text));
        expect(button, `Missing button ${text}`).toBeTruthy();
        await act(async () => button!.click());
        await flushReact();
      };
      const fill = async (selector: string, value: string) => {
        const input = document.body.querySelector<HTMLInputElement>(selector);
        expect(input, `Missing input ${selector}`).toBeTruthy();
        await act(async () => setControlledValue(input!, value));
        await flushReact();
      };
      await fill("#onboarding-company-name", "Local company");
      await click("Продолжить");
      await fill("#onboarding-agent-name", "Локальный агент");
      await click("Далее");
      expect(document.body.querySelector('[aria-label="URL API"]')).not.toBeNull();
      expect(document.querySelector('button[aria-checked]')).toBeNull();
      expect(document.body.textContent).not.toMatch(/Claude|OpenAI|Codex|OpenRouter|Subscription|Continue|Next|Back/);
      return { ...handles, click, fill };
    }

    it.each([false, true])("connects at first startup and creates the first task (key: %s)", async withKey => {
      const { root, click, fill } = await openLocal();
      await fill('[aria-label="URL API"]', "http://localhost:11434/v1");
      await fill('[aria-label="Модель"]', "Qwen/Qwen3-Coder");
      if (withKey) await fill('[aria-label="Ключ API (необязательно)"]', "corporate-local-key");
      expect(JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toMatchObject({ localBaseUrl: "http://localhost:11434/v1", model: "Qwen/Qwen3-Coder" });
      expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toContain("corporate-local-key");
      await click("Подключить");
      expect(mockAgentsApi.adapterModels).not.toHaveBeenCalled();
      expect(managedApi.create).not.toHaveBeenCalled();
      expect(mockAgentsApi.testEnvironment).toHaveBeenCalledWith("created", "pi_local", expect.objectContaining({ runner: "legacy", adapterConfig: expect.objectContaining({ baseUrl: "http://localhost:11434/v1", model: "local/Qwen/Qwen3-Coder" }) }));
      const tested = mockAgentsApi.testEnvironment.mock.calls[0] as unknown as [string, string, { aiConnection?: unknown; adapterConfig: { env?: Record<string, unknown> } }];
      expect(tested[2].aiConnection).toBeUndefined();
      const hire = mockAgentsApi.hire.mock.calls[0] as unknown as [string, { runner: string; onboardingFirstAgent: boolean; adapterConfig: { env?: Record<string, unknown> }; runtimeConfig: { aiConnection?: unknown } }];
      expect(hire[1].runner).toBe("legacy");
      expect(hire[1].onboardingFirstAgent).toBe(true);
      expect(hire[1].runtimeConfig.aiConnection).toBeUndefined();
      expect(hire[1].adapterConfig.env?.OPENAI_API_KEY).toEqual(withKey ? { type: "user_secret_ref", key: expect.stringMatching(/^OPENAI_API_KEY\.setup\./), version: "latest" } : undefined);
      expect(JSON.stringify(hire)).not.toContain("corporate-local-key");
      if (!withKey) expect(mockSecretsApi.createMyUserSecret).not.toHaveBeenCalled();
      await click("Начать работу");
      expect(mockProjectsApi.create).toHaveBeenCalledWith("created", expect.any(Object));
      expect(mockIssuesApi.create).toHaveBeenCalledWith("created", expect.objectContaining({ assigneeAgentId: "agent-1", projectId: "onboarding-project" }));
      await act(async () => root.unmount());
    });

    it("drops a stored key when the initial setup endpoint changes", async () => {
      const { root, click, fill } = await openLocal();
      mockAgentsApi.testEnvironment.mockResolvedValueOnce({ adapterType: "pi_local", status: "fail", checks: [], testedAt: new Date().toISOString() });
      await fill('[aria-label="URL API"]', "https://old.example.internal/v1");
      await fill('[aria-label="Модель"]', "local-model");
      await fill('[aria-label="Ключ API (необязательно)"]', "old-endpoint-key");
      await click("Подключить");
      expect(mockSecretsApi.createMyUserSecret).toHaveBeenCalledTimes(1);
      const firstTest = mockAgentsApi.testEnvironment.mock.calls[0] as unknown as [string, string, { adapterConfig: { env: Record<string, unknown> } }];
      expect(firstTest[2].adapterConfig.env.OPENAI_API_KEY).toMatchObject({ type: "user_secret_ref" });
      await fill('[aria-label="URL API"]', "http://localhost:11434/v1");
      await click("Подключить");
      const nextTest = mockAgentsApi.testEnvironment.mock.calls[1] as unknown as [string, string, { adapterConfig: { baseUrl: string; env?: Record<string, unknown> } }];
      expect(nextTest[2].adapterConfig.baseUrl).toBe("http://localhost:11434/v1");
      expect(nextTest[2].adapterConfig.env?.OPENAI_API_KEY).toBeUndefined();
      expect(mockSecretsApi.createMyUserSecret).toHaveBeenCalledTimes(1);
      await act(async () => root.unmount());
    });

    it("blocks credentials in the URL before storing a key or testing", async () => {
      const { root, click, fill } = await openLocal();
      await fill('[aria-label="URL API"]', "http://user:pass@localhost:11434/v1");
      await fill('[aria-label="Модель"]', "local-model");
      await fill('[aria-label="Ключ API (необязательно)"]', "local-key");
      await click("Подключить");
      expect(document.body.textContent).toContain("Укажите URL API");
      expect(mockSecretsApi.createMyUserSecret).not.toHaveBeenCalled();
      expect(mockAgentsApi.testEnvironment).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    });
  });

});
    it("restores the entered organization, agent, API and stored key after refresh despite an old hosted draft", async () => {
      const setupId = "00000000-0000-4000-8000-000000000099";
      const key = { type: "secret_ref", secretId: "corporate-saved-key", version: "latest" };
      mockCompany.companies = [{ id: "c1", name: "Базар", issuePrefix: "BAZ" }];
      mockCompaniesApi.list.mockResolvedValue(mockCompany.companies);
      mockDialog.onboardingOptions = { companyId: "c1", initialStep: 4 };
      mockAdapterRegistry.list = [{ type: "pi_local" }, { type: "claude_local" }, { type: "codex_local" }];
      mockAgentsApi.get.mockResolvedValue({ id: setupId, companyId: "c1", name: "Начальника", role: "general", adapterType: "codex_local", pauseReason: "setup", runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "responsible_user" } },
        adapterConfig: { baseUrl: "http://corporate.lan/v1", model: "balabol", command: "codex", env: { OPENAI_API_KEY: key } } });
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ step: 4, createdCompanyId: "c1", companyName: "Базар", agentName: "Начальника", setupAgentId: setupId, adapterType: "codex_local", runner: "paperclip", localBaseUrl: "http://corporate.lan/v1", model: "balabol" }));
      const { root, queryClient } = render();
      await renderWizardView(root, queryClient); await flushReact(); await flushReact();
      expect((document.querySelector('[aria-label="URL API"]') as HTMLInputElement).value).toBe("http://corporate.lan/v1");
      expect((document.querySelector('[aria-label="Модель"]') as HTMLInputElement).value).toBe("balabol");
      expect(document.body.textContent).toContain("Начальника");
      expect(document.body.textContent).not.toMatch(/Claude|OpenAI|Codex|OpenRouter|Subscription/);
      const draft = JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)!);
      expect(draft).toMatchObject({ companyName: "Базар", agentName: "Начальника", adapterType: "pi_local", runner: "legacy", localBaseUrl: "http://corporate.lan/v1", model: "balabol" });
      const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === "Подключить")!;
      await act(async () => button.click()); await flushReact();
      const tested = mockAgentsApi.testEnvironment.mock.calls[0] as unknown as [string, string, { runner: string; aiConnection?: unknown; adapterConfig: { baseUrl: string; model: string; command?: string; env: Record<string, unknown> } }];
      expect(tested).toMatchObject(["c1", "pi_local", { runner: "legacy", adapterConfig: { baseUrl: "http://corporate.lan/v1", model: "local/balabol", env: { OPENAI_API_KEY: key } } }]);
      expect(tested[2].adapterConfig.command).toBeUndefined();
      expect(tested[2].aiConnection).toBeUndefined();
      expect(mockAgentsApi.create).not.toHaveBeenCalled();
      expect(managedApi.create).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    });
