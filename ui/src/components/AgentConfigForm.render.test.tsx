// @vitest-environment jsdom

import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Environment, UserSecretDefinition } from "@paperclipai/shared";
import { getEnvironmentCapabilities } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "../context/ToastContext";
import { AgentConfigForm, AdapterLoginPanel, ModelDropdown, subtractPersistedOverlay, type AdapterLoginDescriptor } from "./AgentConfigForm";
import { AgentLifecycleStatus, useAgentLifecycleStatus } from "./AgentLifecycleStatus";
import { queryKeys } from "../lib/queryKeys";
import { defaultCreateValues } from "./agent-config-defaults";
import { buildNewAgentHirePayload } from "../lib/new-agent-hire-payload";
import { ApiError } from "../api/client";
import { aiConnectionsApi } from "../api/ai-connections";
import { CodexLocalConfigFields } from "../adapters/codex-local/config-fields";
import { PiLocalConfigFields } from "../adapters/pi-local/config-fields";
import type { AdapterConfigFieldsProps } from "../adapters/types";
import { buildClaudeLocalConfig } from "@paperclipai/adapter-claude-local/ui";
import { DEFAULT_CODEX_LOCAL_MODEL } from "@paperclipai/adapter-codex-local";

const mockAgentsApi = vi.hoisted(() => ({
  get: vi.fn(),
  adapterModels: vi.fn(),
  detectModel: vi.fn(),
  list: vi.fn(),
  testEnvironment: vi.fn(),
  startAdapterAuthLogin: vi.fn(),
  getAdapterAuthLoginStatus: vi.fn(),
  getActiveAdapterAuthLoginSession: vi.fn(),
  cancelAdapterAuthLogin: vi.fn(),
  startClaudeSetupTokenLogin: vi.fn(),
  getClaudeSetupTokenLoginStatus: vi.fn(),
  getActiveClaudeSetupTokenLoginSession: vi.fn(),
  getClaudeSetupTokenLoginPrompt: vi.fn(),
  submitClaudeSetupTokenBrowserCode: vi.fn(),
  completeClaudeSetupTokenLogin: vi.fn(),
  cancelClaudeSetupTokenLogin: vi.fn(),
  getClaudeOAuthTokenStatus: vi.fn(),
}));

// The default resume read for a test that does not exercise resume: no active
// session for the caller.
function noActiveSession() {
  return Promise.reject(
    new ApiError("Adapter login session not found", 404, { error: "Adapter login session not found" }),
  );
}

const mockClipboard = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(),
}));

const mockEnvironmentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
}));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(),
  getExperimental: vi.fn(),
  getGeneral: vi.fn(),
}));

const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  listProposals: vi.fn(),
  listUserSecretDefinitions: vi.fn(async () => [] as unknown[]),
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/grokBot", () => ({
  grokBotApi: {
    connection: async () => ({ enabled: true, canConfigureConnection: true, binding: null }),
  },
}));

const mockAdaptersApi = vi.hoisted(() => ({ list: vi.fn(async () => [{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "legacy" }]) }));
vi.mock("../api/adapters", () => ({ adaptersApi: mockAdaptersApi }));

vi.mock("../api/environments", () => ({
  environmentsApi: mockEnvironmentsApi,
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("../api/secrets", () => ({
  secretsApi: mockSecretsApi,
}));

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard: mockClipboard.copyTextToClipboard,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Paperclip" }],
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Paperclip" },
    selectionSource: "bootstrap",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

vi.mock("../adapters", () => ({
  getUIAdapter: (type: string) => ({
    type,
    label: type === "hermes_gateway" ? "Hermes Gateway" : "Codex",
    // The stand-in also records the two gates the form resolves for every
    // adapter, so a test can assert the plumbing without rendering a real
    // adapter's fields.
    ConfigFields: (props: AdapterConfigFieldsProps) => {
      if (type === "paperclip_runner") return <CodexLocalConfigFields {...props} />;
      if (type === "pi_local") return <PiLocalConfigFields {...props} />;
      const { adapterType, hideInstructionsFile, managedSandboxOnly } = props;
      return adapterType === "hermes_gateway"
        ? <div data-testid="hermes-gateway-config-fields">Hermes Gateway fields</div>
        : (
          <div
            data-testid="adapter-config-fields"
            data-hide-instructions-file={String(hideInstructionsFile === true)}
            data-managed-sandbox-only={String(managedSandboxOnly === true)}
          />
        );
    },
    buildAdapterConfig: (values: { model?: string }) => ({
      model: values.model || undefined,
    }),
    parseStdoutLine: () => [],
  }),
}));

// The projected login capability per adapter type. The server projects these
// safe scalar fields. `codex_local` drives the displayed-code panel; `claude_local`
// drives the submitted-browser-code panel. A test overrides this map to add a
// third adapter with a projected login capability.
const mockLoginProjections = vi.hoisted(
  () =>
    new Map<string, { panelMode: string; timeoutPolicy: string }>([
      ["codex_local", { panelMode: "displayed_code", timeoutPolicy: "caller_bounded" }],
      ["grok_local", { panelMode: "displayed_code", timeoutPolicy: "caller_bounded" }],
      ["claude_local", { panelMode: "submitted_browser_code", timeoutPolicy: "fixed" }],
      // A third adapter, not a built-in, with a projected displayed-code login.
      ["vendor_local", { panelMode: "displayed_code", timeoutPolicy: "caller_bounded" }],
      // A non-built-in adapter with a submitted-browser-code login. Every login
      // runs on a real pseudo-terminal, so the gate requires the provider pty
      // capability from the login capability, not the adapter name.
      ["pty_vendor_local", { panelMode: "submitted_browser_code", timeoutPolicy: "fixed" }],
    ]),
);

vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => (adapterType: string) => {
    const login = mockLoginProjections.get(adapterType);
    return adapterType === "hermes_gateway"
      ? {
          supportsInstructionsBundle: false,
          supportsSkills: false,
          supportsLocalAgentJwt: false,
          requiresMaterializedRuntimeSkills: false,
          supportsAcp: false,
        }
      : {
          supportsInstructionsBundle: true,
          supportsSkills: true,
          supportsLocalAgentJwt: true,
          requiresMaterializedRuntimeSkills: false,
          supportsAcp: true,
          ...(login ? { login } : {}),
        };
  },
}));

vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => [],
}));

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder ?? "Markdown"}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  });
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Cody",
    role: "Engineer",
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    defaultEnvironmentId: null,
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as Agent;
}

function makeEnvironment(overrides: Partial<Environment>): Environment {
  return {
    id: "env-1",
    name: "Local",
    description: null,
    driver: "local",
    status: "active",
    config: {},
    envVars: {},
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function daytonaEnvironments() {
  return [
    makeEnvironment({ id: "local-1", name: "Local", driver: "local" }),
    makeEnvironment({
      id: "sandbox-1",
      name: "Daytona",
      driver: "sandbox",
      config: { provider: "daytona" },
    }),
  ];
}

function e2bEnvironments() {
  return [
    makeEnvironment({ id: "local-1", name: "Local", driver: "local" }),
    makeEnvironment({
      id: "sandbox-1",
      name: "E2B",
      driver: "sandbox",
      config: { provider: "e2b" },
    }),
  ];
}

function renderFormView(root: Root, queryClient: QueryClient, children: Parameters<Root["render"]>[0]) {
  root.render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function createFormQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

async function renderForm(
  environments: Environment[],
  agentOverrides: Partial<Agent> = {},
  options: {
    showAdapterTestEnvironmentButton?: boolean;
    showAdapterTypeField?: boolean;
    compactTestFeedback?: boolean;
    content?: "configuration" | "secrets";
    environmentVariablesPlacement?: "configuration" | "secrets";
    hideInlineSave?: boolean;
    onDirtyChange?: (dirty: boolean) => void;
    onSaveActionChange?: (save: (() => void) | null) => void;
    onCancelActionChange?: (cancel: (() => void) | null) => void;
  } = {},
) {
  mockEnvironmentsApi.list.mockResolvedValue(environments);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSave = vi.fn();
  const queryClient = createFormQueryClient();

  await act(async () => {
    renderFormView(root, queryClient,
      <AgentConfigForm
        mode="edit"
        agent={makeAgent(agentOverrides)}
        onSave={onSave}
        hidePromptTemplate
        compactTestFeedback={options.compactTestFeedback}
        content={options.content}
        environmentVariablesPlacement={options.environmentVariablesPlacement}
        hideInlineSave={options.hideInlineSave}
        onDirtyChange={options.onDirtyChange}
        onSaveActionChange={options.onSaveActionChange}
        onCancelActionChange={options.onCancelActionChange}
        showAdapterTypeField={options.showAdapterTypeField ?? false}
        showAdapterTestEnvironmentButton={options.showAdapterTestEnvironmentButton ?? false}
      />
    );
  });

  await flushReact();
  return { container, root, onSave };
}

async function renderCreateForm(
  environments: Environment[],
  valueOverrides: Partial<typeof defaultCreateValues> = {},
  options: { showAdapterTestEnvironmentButton?: boolean } = {},
) {
  mockEnvironmentsApi.list.mockResolvedValue(environments);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = createFormQueryClient();

  const values = {
    ...defaultCreateValues,
    adapterType: "codex_local",
    ...valueOverrides,
  };
  const onChange = vi.fn();

  await act(async () => {
    renderFormView(root, queryClient,
      <AgentConfigForm
        mode="create"
        values={values}
        onChange={onChange}
        hidePromptTemplate
        showAdapterTypeField={false}
        showAdapterTestEnvironmentButton={options.showAdapterTestEnvironmentButton ?? false}
      />
    );
  });

  await flushReact();
  return { container, root, onChange };
}

const AUTH_MISSING_RESULT = {
  adapterType: "codex_local",
  status: "fail",
  checks: [
    {
      code: "adapter_auth_missing",
      level: "error",
      message: "The sandbox has no ready authentication.",
    },
  ],
  testedAt: new Date(0).toISOString(),
};

const VENDOR_AUTH_MISSING_RESULT = {
  adapterType: "vendor_local",
  status: "fail",
  checks: [
    {
      code: "adapter_auth_missing",
      level: "error",
      message: "The sandbox has no ready authentication.",
    },
  ],
  testedAt: new Date(0).toISOString(),
};

const GROK_AUTH_MISSING_RESULT = {
  adapterType: "grok_local",
  status: "warn",
  checks: [
    {
      code: "grok_hello_probe_auth_required",
      level: "warn",
      message: "Grok CLI could not answer the hello probe because authentication is missing.",
    },
    {
      code: "adapter_auth_missing",
      level: "warn",
      message: "This environment has no ready authentication for this adapter.",
    },
  ],
  testedAt: new Date(0).toISOString(),
};

const PTY_VENDOR_AUTH_MISSING_RESULT = {
  adapterType: "pty_vendor_local",
  status: "fail",
  checks: [
    {
      code: "adapter_auth_missing",
      level: "error",
      message: "The sandbox has no ready authentication.",
    },
  ],
  testedAt: new Date(0).toISOString(),
};

const CLAUDE_AUTH_MISSING_RESULT = {
  adapterType: "claude_local",
  status: "warn",
  checks: [
    {
      code: "claude_hello_probe_auth_required",
      level: "warn",
      message: "Claude CLI is installed, but login is required.",
    },
    {
      code: "adapter_auth_missing",
      level: "warn",
      message: "The sandbox has no ready authentication for this adapter.",
    },
  ],
  testedAt: new Date(0).toISOString(),
};

// The provider capabilities the form fetches. Daytona advertises the
// setup-token login capability; E2B does not. The Claude login panel shows only
// for a provider with the capability.
const SANDBOX_CAPABILITIES = getEnvironmentCapabilities(["claude_local", "codex_local"], {
  sandboxProviders: {
    daytona: { supportsLoginPty: true, displayName: "Daytona" },
    e2b: { supportsLoginPty: false, displayName: "E2B" },
  },
});

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
}

function findByAriaLabel(container: HTMLElement, label: string) {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

async function renderCodexSandbox(agentOverrides: Partial<Agent> = {}) {
  return renderForm(
    daytonaEnvironments(),
    { defaultEnvironmentId: "sandbox-1", ...agentOverrides },
    { showAdapterTestEnvironmentButton: true },
  );
}

// A third adapter, not a built-in, in a sandbox environment. Its projected login
// capability drives the login affordance and the displayed-code panel. The
// provider advertises the login pseudo-terminal capability the login needs.
async function renderVendorSandbox(agentOverrides: Partial<Agent> = {}) {
  return renderForm(
    daytonaEnvironments(),
    { adapterType: "vendor_local", defaultEnvironmentId: "sandbox-1", ...agentOverrides },
    { showAdapterTestEnvironmentButton: true },
  );
}

// A Grok agent in a sandbox environment. Its projected login capability
// drives the login affordance and the displayed-code panel, the same as
// Codex. The provider advertises the login pseudo-terminal capability the
// login needs.
async function renderGrokSandbox(agentOverrides: Partial<Agent> = {}) {
  return renderForm(
    daytonaEnvironments(),
    { adapterType: "grok_local", defaultEnvironmentId: "sandbox-1", ...agentOverrides },
    { showAdapterTestEnvironmentButton: true },
  );
}

async function renderClaudeSandbox(agentOverrides: Partial<Agent> = {}) {
  return renderForm(
    daytonaEnvironments(),
    { adapterType: "claude_local", defaultEnvironmentId: "sandbox-1", ...agentOverrides },
    { showAdapterTestEnvironmentButton: true },
  );
}

async function renderCreateClaudeSandbox(
  valueOverrides: Partial<typeof defaultCreateValues> = {},
) {
  return renderCreateForm(
    daytonaEnvironments(),
    { adapterType: "claude_local", defaultEnvironmentId: "sandbox-1", ...valueOverrides },
    { showAdapterTestEnvironmentButton: true },
  );
}

// A create-mode harness that holds the form values in React state. A value
// patch from the form (a login claim, an environment change) updates the props,
// so the form re-runs its effects against the new state. The fixed-values
// `renderCreateForm` harness cannot show the environment-change reset, because
// its `values` prop never changes. `valuesRef` exposes the current merged
// values to the test.
async function renderStatefulCreateClaudeSandbox(environments: Environment[]) {
  mockEnvironmentsApi.list.mockResolvedValue(environments);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = createFormQueryClient();

  const valuesRef: { current: typeof defaultCreateValues } = {
    current: {
      ...defaultCreateValues,
      adapterType: "claude_local",
      defaultEnvironmentId: "sandbox-1",
    },
  };

  function Harness() {
    const [values, setValues] = useState(valuesRef.current);
    valuesRef.current = values;
    return (
      <AgentConfigForm
        mode="create"
        values={values}
        onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
        hidePromptTemplate
        showAdapterTypeField={false}
        showAdapterTestEnvironmentButton
      />
    );
  }

  await act(async () => {
    renderFormView(root, queryClient, <Harness />);
  });

  await flushReact();
  return { container, root, valuesRef };
}

async function environmentOptions(container: HTMLElement) {
  const picker = container.querySelector('[aria-label="Environment override"]');
  expect(picker).not.toBeNull();
  await clickElement(picker);
  const options = document.body.querySelector('[role="listbox"][aria-label="Environment override"]');
  expect(options).not.toBeNull();
  return options!;
}

async function selectEnvironment(container: HTMLElement, environmentId: string) {
  const options = await environmentOptions(container);
  const option = options.querySelector(`[role="option"][data-value="${environmentId}"]`);
  expect(option).not.toBeNull();
  await clickElement(option);
}

async function clickByText(container: HTMLElement, label: string) {
  const button = findButton(container, label);
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flushReact();
}

async function clickElement(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flushReact();
}

async function runTest(container: HTMLElement) {
  await clickByText(container, "Test");
}

async function startLogin(container: HTMLElement) {
  await clickByText(container, "Sign in");
  await flushReact();
}

// Flush React effects and pending promises until a condition holds. The Claude
// login chains a start, a status poll, and a completion read, so a single flush
// does not settle every state transition.
async function flushUntil(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) break;
    await flushReact();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await flushReact();
}

describe("AgentConfigForm environment selector", () => {
  let roots: Root[] = [];

  beforeEach(() => {
    mockAgentsApi.adapterModels.mockResolvedValue([]);
    mockAgentsApi.detectModel.mockResolvedValue(null);
    mockAgentsApi.list.mockResolvedValue([]);
    mockAgentsApi.testEnvironment.mockResolvedValue({
      adapterType: "codex_local",
      status: "pass",
      checks: [],
      testedAt: new Date(0).toISOString(),
    });
    mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: null });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableEnvironments: true });
    mockInstanceSettingsApi.getGeneral.mockResolvedValue({ executionMode: "any" });
    mockEnvironmentsApi.capabilities.mockResolvedValue(SANDBOX_CAPABILITIES);
    mockSecretsApi.list.mockResolvedValue([]);
    mockSecretsApi.listProposals.mockResolvedValue([]);
    // Default: the caller has no active session. A resume test overrides this
    // with a resolved session body.
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockImplementation(noActiveSession);
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockImplementation(noActiveSession);
    mockAgentsApi.startAdapterAuthLogin.mockResolvedValue({
      sessionId: "session-1",
      environmentId: "sandbox-1",
      status: "starting",
      expiresAt: null,
      failure: null,
    });
    mockAgentsApi.getAdapterAuthLoginStatus.mockResolvedValue({
      sessionId: "session-1",
      environmentId: "sandbox-1",
      status: "waiting_for_user",
      expiresAt: null,
      failure: null,
      prompt: { url: "https://auth.example.test/device", code: "WXYZ-1234" },
    });
    mockAgentsApi.cancelAdapterAuthLogin.mockResolvedValue({
      sessionId: "session-1",
      environmentId: "sandbox-1",
      status: "cancelled",
      expiresAt: null,
      failure: null,
      prompt: null,
    });
    mockClipboard.copyTextToClipboard.mockResolvedValue(undefined);
    mockAgentsApi.startClaudeSetupTokenLogin.mockResolvedValue({
      sessionId: "claude-session-1",
      environmentId: "sandbox-1",
      status: "starting",
      expiresAt: null,
      failure: null,
      panelMode: "submitted_browser_code",
      prompt: null,
    });
    mockAgentsApi.getClaudeSetupTokenLoginStatus.mockResolvedValue({
      sessionId: "claude-session-1",
      environmentId: "sandbox-1",
      status: "waiting_for_user",
      expiresAt: null,
      failure: null,
    });
    mockAgentsApi.getClaudeSetupTokenLoginPrompt.mockResolvedValue({
      authorizationUrl: "https://claude.example.test/authorize",
    });
    mockAgentsApi.submitClaudeSetupTokenBrowserCode.mockResolvedValue({
      sessionId: "claude-session-1",
      environmentId: "sandbox-1",
      status: "authenticated",
      expiresAt: null,
      failure: null,
    });
    mockAgentsApi.completeClaudeSetupTokenLogin.mockResolvedValue({
      storedSessionId: "stored-session-1",
    });
    mockAgentsApi.cancelClaudeSetupTokenLogin.mockResolvedValue(undefined);
    // Default: the owner has no stored Claude login. A test that needs a stored
    // value overrides this with a status body.
    mockAgentsApi.getClaudeOAuthTokenStatus.mockResolvedValue(null);
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => {
        root.unmount();
      });
    }
    roots = [];
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });


  it("clears a new agent's environment override to the empty draft value", async () => {
    const result = await renderCreateForm(daytonaEnvironments(), { defaultEnvironmentId: "sandbox-1", runner: "legacy" });
    roots.push(result.root);
    await selectEnvironment(result.container, "");
    expect(result.onChange).toHaveBeenLastCalledWith({ defaultEnvironmentId: "" });
  });

  it("promotes environment drafts through the page Save action and discards them through the page Discard action", async () => {
    const dirty = vi.fn();
    let save: (() => void) | null = null;
    let discard: (() => void) | null = null;
    const result = await renderForm([], {}, {
      content: "secrets", environmentVariablesPlacement: "secrets", hideInlineSave: true,
      onDirtyChange: dirty,
      onSaveActionChange: action => { save = action; },
      onCancelActionChange: action => { discard = action; },
    });
    roots.push(result.root);
    const add = [...result.container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Add variable")!;
    await act(async () => add.click());
    await act(async () => {
      setInputValue(result.container.querySelector<HTMLInputElement>('input[aria-label="Variable name"]')!, "ONBOARDING_SMOKE");
      setInputValue(result.container.querySelector<HTMLInputElement>('input[aria-label="Variable value"]')!, "true");
    });
    await flushReact();
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect([...result.container.querySelectorAll("button")].some(button => button.textContent?.trim() === "Save")).toBe(false);
    await act(async () => { await save?.(); });
    expect(result.onSave).toHaveBeenCalledWith(expect.objectContaining({ adapterConfig: expect.objectContaining({ env: { ONBOARDING_SMOKE: { type: "plain", value: "true" } } }) }));
    await act(async () => discard?.());
    await flushReact();
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(result.container.querySelector('input[aria-label="Variable name"]')).toBeNull();
  });

  it("reads and saves Pi thinking effort using the Pi runtime key", async () => {
    const result = await renderForm([], { adapterType: "pi_local", adapterConfig: { model: "openrouter/anthropic/claude-sonnet-4.6", thinking: "high" } });
    roots.push(result.root);
    const effort = [...result.container.querySelectorAll("button")].find(button => button.textContent?.trim() === "high")!;
    expect(effort).toBeTruthy();
    await act(async () => effort.click());
    await flushReact();
    const low = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "lowlow")!;
    expect(low).toBeTruthy();
    await act(async () => low.click());
    await flushReact();
    const save = [...result.container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Save")!;
    await act(async () => save.click());
    expect(result.onSave).toHaveBeenCalledWith(expect.objectContaining({ adapterConfig: expect.objectContaining({ thinking: "low" }) }));
    expect(result.onSave.mock.calls[0][0].adapterConfig.effort).toBeUndefined();
  });

  it("edits a local Pi model without provider catalogs, detection, or accounts", async () => {
    const accounts = vi.spyOn(aiConnectionsApi, "list").mockResolvedValue({ currentUserId: "you", canManageConnections: true, connections: [] });
    try {
      const result = await renderForm([], { adapterType: "pi_local", adapterConfig: { baseUrl: "http://localhost:11434/v1", model: "local/old" } });
      roots.push(result.root);
      expect(mockAgentsApi.adapterModels).not.toHaveBeenCalled();
      expect(mockAgentsApi.detectModel).not.toHaveBeenCalled();
      expect(accounts).not.toHaveBeenCalled();
      expect(result.container.textContent).not.toContain("legacy credentials");
      await clickByText(result.container, "Advanced");
      expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
      await act(() => setInputValue(result.container.querySelector<HTMLInputElement>('[aria-label="Модель"]')!, "Qwen/Qwen3-Coder"));
      await clickByText(result.container, "Save");
      expect(result.onSave.mock.calls[0][0].adapterConfig.model).toBe("local/Qwen/Qwen3-Coder");
      expect(result.onSave.mock.calls[0][0].runner).toBe("legacy");
    } finally { accounts.mockRestore(); }
  });

  it.each(["pi_local", "codex_local", "paperclip_runner"])("keeps an unconfigured %s edit on the local-only form", async adapterType => {
    const accounts = vi.spyOn(aiConnectionsApi, "list").mockResolvedValue({ currentUserId: "you", canManageConnections: true, connections: [] });
    try {
      const result = await renderForm([], { adapterType, adapterConfig: {} }, { showAdapterTypeField: true });
      roots.push(result.root);
      expect(result.container.querySelector('[placeholder="http://localhost:11434/v1"]')).not.toBeNull();
      expect(result.container.querySelector('[aria-label="Модель"]')).not.toBeNull();
      expect(result.container.querySelector('[aria-label="Harness"]')).toBeNull();
      expect(mockAgentsApi.adapterModels).not.toHaveBeenCalled();
      expect(mockAgentsApi.detectModel).not.toHaveBeenCalled();
      expect(accounts).not.toHaveBeenCalled();
    } finally { accounts.mockRestore(); }
  });

  it("uses manual local Pi models in the shared creation form", async () => {
    const result = await renderCreateForm([], { adapterType: "pi_local", runner: "paperclip", adapterSchemaValues: { baseUrl: "http://localhost:11434/v1" }, model: "local/old" });
    roots.push(result.root);
    expect(mockAgentsApi.adapterModels).not.toHaveBeenCalled();
    expect(mockAgentsApi.detectModel).not.toHaveBeenCalled();
    expect(result.onChange).toHaveBeenCalledWith({ runner: "legacy", resolvedRunner: "legacy" });
    await act(() => setInputValue(result.container.querySelector<HTMLInputElement>('[aria-label="Модель"]')!, "qwen3:8b"));
    expect(result.onChange).toHaveBeenCalledWith({ model: "local/qwen3:8b" });
  });

  it.each([undefined, "https://previous.example/v1"])("drops the previous key and account before testing or saving local Pi from %s", async baseUrl => {
    const result = await renderForm([], {
      adapterType: "pi_local",
      adapterConfig: { baseUrl, model: baseUrl ? "local/qwen" : "openai/qwen", env: { CLAUDE_CODE_OAUTH_TOKEN: { type: "secret_ref", secretId: "old-claude-token", version: "latest" }, OPENAI_API_KEY: { type: "secret_ref", secretId: "old-key", version: "latest" }, KEEP: { type: "plain", value: "keep" } } },
      runtimeConfig: { aiConnection: { mode: "responsible_user", provider: "openrouter", method: "api_key" }, heartbeat: { enabled: false } },
    }, { showAdapterTestEnvironmentButton: true });
    roots.push(result.root);
    await act(() => setInputValue(result.container.querySelector<HTMLInputElement>('[placeholder="http://localhost:11434/v1"]')!, "http://inference.lan:8000/v1"));
    await clickByText(result.container, "Test");
    const tested = mockAgentsApi.testEnvironment.mock.calls[0][2];
    expect(tested.aiConnection).toBeUndefined();
    expect(tested.runner).toBe("legacy");
    expect(tested.adapterConfig.env).toEqual({ KEEP: { type: "plain", value: "keep" } });
    await clickByText(result.container, "Save");
    const patch = result.onSave.mock.calls[0][0];
    expect(patch.adapterConfig.env).toEqual({ KEEP: { type: "plain", value: "keep" } });
    expect(patch.adapterConfig.model).toBe(baseUrl ? "local/qwen" : "local/openai/qwen");
    expect(patch.runtimeConfig).toEqual({ heartbeat: { enabled: false } });
  });

  it("preserves an explicitly edited local Pi key when the endpoint changes", async () => {
    const result = await renderForm([], { adapterType: "pi_local", adapterConfig: { baseUrl: "https://previous.example/v1", model: "local/qwen", env: { OPENAI_API_KEY: { type: "plain", value: "old-key" } } } });
    roots.push(result.root);
    await act(() => setInputValue(result.container.querySelector<HTMLInputElement>('[placeholder="http://localhost:11434/v1"]')!, "https://new.example/v1"));
    const keyInput = result.container.querySelector<HTMLInputElement>('input[aria-label="Variable value"]');
    expect(keyInput).not.toBeNull();
    await act(() => setInputValue(keyInput!, "new-key"));
    await clickByText(result.container, "Save");
    expect(result.onSave.mock.calls[0][0].adapterConfig.env.OPENAI_API_KEY).toEqual({ type: "plain", value: "new-key" });
  });

  it("hides the environment override when Local is the only configured environment", async () => {
    const result = await renderForm([
      makeEnvironment({ id: "local-1", name: "Local", driver: "local" }),
    ]);
    roots.push(result.root);

    expect(result.container.textContent).not.toContain("Secret access");

    expect(result.container.textContent).not.toContain("Environment override");
    expect(result.container.querySelector('[aria-label="Environment override"]')).toBeNull();
  });

  it("renders secret access as dedicated form content", async () => {
    const result = await renderForm(
      [makeEnvironment({ id: "local-1", name: "Local", driver: "local" })],
      {},
      { content: "secrets" },
    );
    roots.push(result.root);

    expect(result.container.textContent).toContain("Secret access");
    expect(result.container.textContent).toContain("No secrets are bound to this agent yet.");
    expect(result.container.textContent).not.toContain("Environment variables");
  });

  it("shows concise Environment copy when one runnable non-local environment exists", async () => {
    const result = await renderForm(e2bEnvironments());
    roots.push(result.root);

    const text = result.container.textContent ?? "";
    const selector = await environmentOptions(result.container);

    expect(text).toContain("Environment");
    expect(text).toContain("Environment override");
    expect(selector?.textContent).toContain("Default: Local");
    expect(selector?.textContent).toContain("E2B · sandbox");
    expect(text).not.toContain("Execution");
    expect(text).not.toContain("Leave this unset to inherit the instance default");
    expect(text).not.toContain("Inherit instance default");
  });

  it("shows the environment override for Grok local agents", async () => {
    const result = await renderForm(
      e2bEnvironments(),
      { adapterType: "grok_local" },
    );
    roots.push(result.root);

    const text = result.container.textContent ?? "";
    const selector = await environmentOptions(result.container);

    expect(text).toContain("Environment override");
    expect(selector?.textContent).toContain("E2B · sandbox");
  });

  it("shows the environment override for Kimi local agents", async () => {
    const result = await renderForm(
      e2bEnvironments(),
      { adapterType: "kimi_local" },
    );
    roots.push(result.root);

    const text = result.container.textContent ?? "";
    const selector = await environmentOptions(result.container);

    expect(text).toContain("Environment override");
    expect(selector?.textContent).toContain("E2B · sandbox");
  });

  it("keeps an existing non-runnable override visible so it can be cleared", async () => {
    const result = await renderForm(
      [
        makeEnvironment({ id: "local-1", name: "Local", driver: "local" }),
        makeEnvironment({
          id: "fake-sandbox-1",
          name: "Fake Sandbox",
          driver: "sandbox",
          config: { provider: "fake" },
        }),
      ],
      { defaultEnvironmentId: "fake-sandbox-1" },
    );
    roots.push(result.root);

    const text = result.container.textContent ?? "";
    const selector = await environmentOptions(result.container);

    expect(text).toContain("Environment override");
    expect(selector?.textContent).toContain("Default: Local");
    expect(selector?.textContent).toContain("Fake Sandbox · sandbox");
  });

  it("labels the platform-managed instance default by name, without the driver key", async () => {
    mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: "managed-1" });
    const result = await renderForm([
      makeEnvironment({
        id: "managed-1",
        name: "Paperclip Computer",
        driver: "sandbox",
        config: { provider: "daytona" },
        metadata: { managedByPaperclip: true },
      }),
    ]);
    roots.push(result.root);

    const selector = await environmentOptions(result.container);

    expect(selector?.textContent).toContain("Default: Paperclip Computer");
    expect(selector?.textContent).toContain("Paperclip Computer");
    expect(selector?.textContent).not.toContain("(sandbox)");
    expect(selector?.textContent).not.toContain("· sandbox");
  });

  it("surfaces request failures instead of converting them into model test checks", async () => {
    mockAgentsApi.testEnvironment.mockRejectedValueOnce(new Error("Network unavailable"));

    const result = await renderForm([
      makeEnvironment({ id: "local-1", name: "Local", driver: "local" }),
    ], {
      adapterConfig: { model: "gpt-5.4" },
    }, {
      showAdapterTestEnvironmentButton: true,
    });
    roots.push(result.root);

    const testButton = Array.from(result.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Test",
    );
    expect(testButton).toBeTruthy();

    await act(async () => {
      testButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockAgentsApi.testEnvironment).toHaveBeenCalledTimes(1);
    expect(result.container.textContent).toContain("Network unavailable");
  });

  it("hides the Login button for a Daytona sandbox while the capabilities report no setup-token support", async () => {
    // Reproduces the reported defect: the Test carries the auth-missing check,
    // but the capabilities endpoint reports `supportsLoginPty: false`
    // for Daytona (a stale persisted plugin manifest). The gate hides the
    // panel. The server-side fix refreshes the persisted manifest so the
    // capability reports true and the panel shows (see the companion positive
    // test above).
    mockAgentsApi.testEnvironment.mockResolvedValue(CLAUDE_AUTH_MISSING_RESULT);
    mockEnvironmentsApi.capabilities.mockResolvedValue(
      getEnvironmentCapabilities(["claude_local", "codex_local"], {
        sandboxProviders: {
          daytona: { supportsLoginPty: false, displayName: "Daytona" },
        },
      }),
    );
    const result = await renderForm(
      daytonaEnvironments(),
      { adapterType: "claude_local", defaultEnvironmentId: "sandbox-1" },
      { showAdapterTestEnvironmentButton: true },
    );
    roots.push(result.root);

    await runTest(result.container);

    expect(findButton(result.container, "Sign in")).toBeFalsy();
  });

  it("does not show the Login button when the Test result has no adapter_auth_missing check", async () => {
    const result = await renderCodexSandbox();
    roots.push(result.root);

    await runTest(result.container);

    expect(findButton(result.container, "Sign in")).toBeFalsy();
  });

  it("does not show the Login button when the effective environment is Local", async () => {
    mockAgentsApi.testEnvironment.mockResolvedValue(AUTH_MISSING_RESULT);
    const result = await renderForm(
      [makeEnvironment({ id: "local-1", name: "Local", driver: "local" })],
      {},
      { showAdapterTestEnvironmentButton: true },
    );
    roots.push(result.root);

    await runTest(result.container);

    expect(findButton(result.container, "Sign in")).toBeFalsy();
  });

  it("keeps the Login button hidden under the managed-sandbox-only policy when no managed sandbox is available", async () => {
    // The policy is on, but no managed sandbox environment exists, so the login
    // target resolution fails closed. The render catches that failure and
    // resolves no login environment, so the affordance stays hidden. The Test
    // surfaces the same case as a fail-closed error.
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableEnvironments: true,
      enableManagedSandboxOnly: true,
    });
    mockAgentsApi.testEnvironment.mockResolvedValue(CLAUDE_AUTH_MISSING_RESULT);
    const result = await renderForm(
      [
        makeEnvironment({
          id: "local-1",
          name: "Local",
          driver: "local",
          metadata: { defaultForInstance: true },
        }),
      ],
      { adapterType: "claude_local", defaultEnvironmentId: null },
      { showAdapterTestEnvironmentButton: true },
    );
    roots.push(result.root);

    expect(findButton(result.container, "Sign in")).toBeFalsy();
  });

  it("recovers a previous-environment sign-in only after explicit successful cancellation", async () => {
    const intent = { provider: "xai", method: "subscription", name: "My Grok subscription", ownership: "personal", agentIds: [], allAgents: true } as const;
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockResolvedValueOnce({
      sessionId: "previous-login", environmentId: "previous-sandbox", aiConnection: intent,
      status: "waiting_for_user", prompt: null,
    }).mockImplementation(noActiveSession);
    mockAgentsApi.cancelAdapterAuthLogin.mockRejectedValueOnce(new Error("Network unavailable"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container); roots.push(root);
    const queryClient = createFormQueryClient();
    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel companyId="company-1" adapterType="grok_local" environmentId="new-sandbox"
        aiConnection={{ ...intent, agentIds: [] }} chrome="onboarding" autoStart />
      );
    });
    await flushUntil(() => Boolean(findButton(container, "Cancel previous sign-in and retry")));
    expect(mockAgentsApi.startAdapterAuthLogin).not.toHaveBeenCalled();
    expect(mockAgentsApi.cancelAdapterAuthLogin).not.toHaveBeenCalled();
    await act(async () => findButton(container, "Cancel previous sign-in and retry")!.click());
    await flushUntil(() => container.textContent?.includes("Could not cancel") ?? false);
    expect(mockAgentsApi.startAdapterAuthLogin).not.toHaveBeenCalled();
    let release!: () => void;
    mockAgentsApi.cancelAdapterAuthLogin.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    await act(async () => findButton(container, "Cancel previous sign-in and retry")!.click());
    await flushReact();
    expect(findButton(container, "Cancel previous sign-in and retry")!.disabled).toBe(true);
    expect(mockAgentsApi.startAdapterAuthLogin).not.toHaveBeenCalled();
    await act(async () => release());
    await flushUntil(() => mockAgentsApi.startAdapterAuthLogin.mock.calls.length === 1);
    expect(mockAgentsApi.cancelAdapterAuthLogin).toHaveBeenLastCalledWith("company-1", "grok_local", "previous-login");
    expect(mockAgentsApi.startAdapterAuthLogin).toHaveBeenCalledWith("company-1", "grok_local", { environmentId: "new-sandbox", aiConnection: intent });
    queryClient.clear();
  });

  it("offers no Cancel in the onboarding chrome", async () => {
    // The card carried a Cancel beside its instruction, directly above the
    // step's own Back. Two ways out of one screen is one too many, so the
    // button went — and with it the only explicit release, since unmounting
    // deliberately keeps the session alive for a later resume. An abandoned
    // login is now collected by the server deadline, the same as one abandoned
    // by closing the tab.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="codex_local"
          environmentId="sandbox-1"
          chrome="onboarding"
          autoStart
        />
      );
    });
    // Wait for the card itself, then assert it is actually there: an absence
    // check over an empty render passes for the wrong reason.
    await flushUntil(() => container.textContent?.includes("authorization code") ?? false);
    expect(container.textContent).toContain("authorization code");

    expect(findButton(container, "Cancel")).toBeFalsy();
    expect(mockAgentsApi.cancelAdapterAuthLogin).not.toHaveBeenCalled();
  });
  it("reports the account-binding claim upward exactly once when the session authenticates", async () => {
    // The authenticated owner read can carry the non-secret Codex
    // account-binding claim. The panel hands it to the caller once; the
    // caller (the edit-mode form) decides whether a bind is warranted.
    mockAgentsApi.startAdapterAuthLogin.mockResolvedValue({
      sessionId: "bind-session-1",
      environmentId: "sandbox-1",
      status: "waiting_for_user",
      expiresAt: null,
      failure: null,
      prompt: { url: "https://auth.example.test/bind", code: "BIND-1" },
    });
    mockAgentsApi.getAdapterAuthLoginStatus.mockResolvedValue({
      sessionId: "bind-session-1",
      environmentId: "sandbox-1",
      status: "authenticated",
      expiresAt: null,
      failure: null,
      prompt: null,
      codexAccountBinding: { secretId: "secret-bind-1", companyIdentityDiffers: true },
    });
    const onAccountBinding = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="codex_local"
          environmentId="sandbox-1"
          autoStart
          onAccountBinding={onAccountBinding}
        />
      );
    });
    await flushUntil(() => onAccountBinding.mock.calls.length > 0);

    expect(onAccountBinding).toHaveBeenCalledTimes(1);
    expect(onAccountBinding).toHaveBeenCalledWith({
      secretId: "secret-bind-1",
      companyIdentityDiffers: true,
    });
    // The panel narrates the bind as its own state, separate from the login's
    // success line — the bind is a second save that can still fail.
    await flushUntil(() => container.textContent?.includes("Agent bound to the signed-in account") ?? false);
    expect(container.textContent).toContain("Agent bound to the signed-in account");
  });

  it("a failed bind save renders an explicit Retry instead of silently latching the claim", async () => {
    // The status poll stops at the terminal state, so a rejected save behind
    // a fire-and-forget latch would leave nothing to re-fire the bind. The
    // panel keeps the claim and offers Retry.
    mockAgentsApi.startAdapterAuthLogin.mockResolvedValue({
      sessionId: "bind-session-2",
      environmentId: "sandbox-1",
      status: "waiting_for_user",
      expiresAt: null,
      failure: null,
      prompt: { url: "https://auth.example.test/bind", code: "BIND-2" },
    });
    mockAgentsApi.getAdapterAuthLoginStatus.mockResolvedValue({
      sessionId: "bind-session-2",
      environmentId: "sandbox-1",
      status: "authenticated",
      expiresAt: null,
      failure: null,
      prompt: null,
      codexAccountBinding: { secretId: "secret-bind-2", companyIdentityDiffers: true },
    });
    const onAccountBinding = vi
      .fn()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="codex_local"
          environmentId="sandbox-1"
          autoStart
          onAccountBinding={onAccountBinding}
        />
      );
    });
    await flushUntil(() => container.textContent?.includes("Could not bind this agent") ?? false);
    const retry = findButton(container, "Retry");
    expect(retry).toBeTruthy();

    await act(async () => {
      retry!.click();
    });
    await flushUntil(() => container.textContent?.includes("Agent bound to the signed-in account") ?? false);
    expect(onAccountBinding).toHaveBeenCalledTimes(2);
    expect(onAccountBinding).toHaveBeenLastCalledWith({
      secretId: "secret-bind-2",
      companyIdentityDiffers: true,
    });
  });

  it("a second login in the same mounted panel runs its own bind", async () => {
    // The terminal state re-enables Sign in without unmounting the panel. The
    // bind latch is scoped to the session, so a second cross-account login
    // binds again with ITS claim instead of being silently skipped.
    mockAgentsApi.startAdapterAuthLogin
      .mockResolvedValueOnce({
        sessionId: "rebind-s1",
        environmentId: "sandbox-1",
        status: "waiting_for_user",
        expiresAt: null,
        failure: null,
        prompt: { url: "https://auth.example.test/rebind", code: "REBIND-1" },
      })
      .mockResolvedValueOnce({
        sessionId: "rebind-s2",
        environmentId: "sandbox-1",
        status: "waiting_for_user",
        expiresAt: null,
        failure: null,
        prompt: { url: "https://auth.example.test/rebind", code: "REBIND-2" },
      });
    mockAgentsApi.getAdapterAuthLoginStatus.mockImplementation(
      async (_companyId: string, _adapterType: string, sid: string) => ({
        sessionId: sid,
        environmentId: "sandbox-1",
        status: "authenticated",
        expiresAt: null,
        failure: null,
        prompt: null,
        codexAccountBinding: {
          secretId: sid === "rebind-s2" ? "secret-second" : "secret-first",
          companyIdentityDiffers: true,
        },
      }),
    );
    const onAccountBinding = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="codex_local"
          environmentId="sandbox-1"
          autoStart
          onAccountBinding={onAccountBinding}
        />
      );
    });
    await flushUntil(() => onAccountBinding.mock.calls.length === 1);
    expect(onAccountBinding).toHaveBeenLastCalledWith({
      secretId: "secret-first",
      companyIdentityDiffers: true,
    });

    const signIn = findButton(container, "Sign in");
    expect(signIn).toBeTruthy();
    await act(async () => {
      signIn!.click();
    });
    await flushUntil(() => onAccountBinding.mock.calls.length === 2);
    expect(onAccountBinding).toHaveBeenLastCalledWith({
      secretId: "secret-second",
      companyIdentityDiffers: true,
    });
  });

  it("a new Sign in stays disabled while the bind save is in flight", async () => {
    // Two overlapping bind saves can land out of order — the older save
    // finishing last would silently revert the agent to the previous account.
    // The panel serializes at its only entry point: Sign in is disabled until
    // the current bind settles.
    mockAgentsApi.startAdapterAuthLogin.mockResolvedValue({
      sessionId: "serialize-s1",
      environmentId: "sandbox-1",
      status: "waiting_for_user",
      expiresAt: null,
      failure: null,
      prompt: { url: "https://auth.example.test/serialize", code: "SER-1" },
    });
    mockAgentsApi.getAdapterAuthLoginStatus.mockResolvedValue({
      sessionId: "serialize-s1",
      environmentId: "sandbox-1",
      status: "authenticated",
      expiresAt: null,
      failure: null,
      prompt: null,
      codexAccountBinding: { secretId: "secret-serialize", companyIdentityDiffers: true },
    });
    let releaseSave: (() => void) | null = null;
    const onAccountBinding = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="codex_local"
          environmentId="sandbox-1"
          autoStart
          onAccountBinding={onAccountBinding}
        />
      );
    });
    await flushUntil(() => container.textContent?.includes("Binding this agent") ?? false);
    const signInWhileSaving = findButton(container, "Sign in");
    expect(signInWhileSaving).toBeTruthy();
    expect(signInWhileSaving!.disabled).toBe(true);

    await act(async () => {
      releaseSave?.();
    });
    await flushUntil(() => container.textContent?.includes("Agent bound to the signed-in account") ?? false);
    const signInAfterSave = findButton(container, "Sign in");
    expect(signInAfterSave!.disabled).toBe(false);
  });

  it("keeps unsaved configuration while a lifecycle poll updates progress", async () => {
    const saved = makeAgent({ lifecycleState: "preparing", lifecycleVersion: 1 });
    mockAgentsApi.get.mockResolvedValue(saved);
    mockEnvironmentsApi.list.mockResolvedValue([]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSave = vi.fn();
    function Harness() {
      const lifecycle = useAgentLifecycleStatus(saved);
      return <>
        <AgentLifecycleStatus agent={lifecycle.data ?? saved} refreshError={lifecycle.isError} onRetry={() => {}} retryPending={false} />
        <AgentConfigForm mode="edit" agent={saved} onSave={onSave} hidePromptTemplate showAdapterTypeField={false} />
      </>;
    }
    await act(async () => renderFormView(root, queryClient, <Harness />));
    await flushReact();
    const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Agent name"]')!;
    setInputValue(nameInput, "Unsaved name");
    await flushReact();
    let finishPoll!: (agent: Agent) => void;
    mockAgentsApi.get.mockReturnValueOnce(new Promise<Agent>(resolve => { finishPoll = resolve; }));
    let poll!: Promise<void>;
    await act(async () => { poll = queryClient.refetchQueries({ queryKey: [...queryKeys.agents.detail(saved.id), "lifecycle"] }); });
    // Editing can continue while the request is in flight.
    setInputValue(nameInput, "Edited during poll");
    await flushReact();
    await act(async () => {
      finishPoll({ ...saved, name: "Another saved name", lifecycleState: "verifying", lifecycleVersion: 2 });
      await poll;
    });
    await flushReact();
    expect(mockAgentsApi.get).toHaveBeenCalledWith(saved.id, saved.companyId);
    expect(container.textContent).toContain("Verifying agent");
    expect(nameInput.value).toBe("Edited during poll");
    await act(async () => findButton(container, "Save")!.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Edited during poll" }));
    mockAgentsApi.get.mockRejectedValueOnce(new Error("Status unavailable"));
    await act(async () => { await queryClient.refetchQueries({ queryKey: [...queryKeys.agents.detail(saved.id), "lifecycle"] }); });
    await flushReact();
    expect(container.textContent).toContain("Could not refresh agent lifecycle status");
    expect(nameInput.value).toBe("Edited during poll");
    queryClient.clear();
  });

  it("reports the non-secret stored-session claim to the parent on success", async () => {
    mockAgentsApi.testEnvironment.mockResolvedValue(CLAUDE_AUTH_MISSING_RESULT);
    mockAgentsApi.getClaudeSetupTokenLoginStatus.mockResolvedValue({
      sessionId: "claude-session-1",
      environmentId: "sandbox-1",
      status: "authenticated",
      expiresAt: null,
      failure: null,
    });
    const onStored = vi.fn();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="claude_local"
          environmentId="sandbox-1"
          onStored={onStored}
        />
      );
    });
    await startLogin(container);
    await flushUntil(() => onStored.mock.calls.length > 0);

    expect(onStored).toHaveBeenCalledWith("stored-session-1");
  });

  it("offers no Cancel in the onboarding chrome", async () => {
    // The card carried a Cancel beside its instruction, directly above the
    // step's own Back. Two ways out of one screen is one too many, so the
    // button went — and with it the only explicit release, since unmounting
    // deliberately keeps the session alive for a later resume. An abandoned
    // login is now collected by the server deadline, the same as one abandoned
    // by closing the tab.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="claude_local"
          environmentId="sandbox-1"
          chrome="onboarding"
          autoStart
        />
      );
    });
    // Wait for the card itself, then assert it is actually there: an absence
    // check over an empty render passes for the wrong reason.
    await flushUntil(() => container.textContent?.includes("authorization code") ?? false);
    expect(container.textContent).toContain("authorization code");

    expect(findButton(container, "Cancel")).toBeFalsy();
    expect(mockAgentsApi.cancelClaudeSetupTokenLogin).not.toHaveBeenCalled();
  });
  it("offers an apply-existing affordance when the status route reports a stored value", async () => {
    mockAgentsApi.getClaudeOAuthTokenStatus.mockResolvedValue({
      secretId: "secret-1",
      latestVersion: 3,
    });
    const onApplyStored = vi.fn();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="claude_local"
          environmentId="sandbox-1"
          onApplyStored={onApplyStored}
        />
      );
    });
    await flushUntil(() => Boolean(findButton(container, "Use saved login")));

    await clickByText(container, "Use saved login");

    expect(onApplyStored).toHaveBeenCalledTimes(1);
    // The panel shows the applied confirmation and hides the apply affordance.
    await flushUntil(() =>
      (container.textContent ?? "").includes("The saved Claude login is bound to this agent now."),
    );
    expect(findButton(container, "Use saved login")).toBeUndefined();
    // The apply-existing path never starts a login round trip.
    expect(mockAgentsApi.startClaudeSetupTokenLogin).not.toHaveBeenCalled();
  });

  it("does not offer the apply-existing affordance when there is no stored value", async () => {
    mockAgentsApi.getClaudeOAuthTokenStatus.mockResolvedValue(null);
    const onApplyStored = vi.fn();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = createFormQueryClient();

    await act(async () => {
      renderFormView(root, queryClient,
        <AdapterLoginPanel
          companyId="company-1"
          adapterType="claude_local"
          environmentId="sandbox-1"
          onApplyStored={onApplyStored}
        />
      );
    });
    await flushUntil(() => Boolean(findButton(container, "Sign in")));

    expect(findButton(container, "Use saved login")).toBeUndefined();
    expect(onApplyStored).not.toHaveBeenCalled();
  });


});

const FIXED_CLAUDE_OAUTH_BINDING = {
  type: "user_secret_ref",
  key: "CLAUDE_CODE_OAUTH_TOKEN",
  version: "latest",
  required: true,
};

// Read the merged create-mode values after one or more onChange patches. The
// create form emits a partial patch, so later assertions merge every patch onto
// the seed values, the same way the parent page keeps the controlled state.
function mergedCreateValues(
  seed: Record<string, unknown>,
  onChange: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  return onChange.mock.calls.reduce(
    (acc, [patch]) => ({ ...acc, ...(patch as Record<string, unknown>) }),
    { ...seed },
  );
}

describe("AgentConfigForm managed-sandbox-only host surfaces", () => {
  let roots: Root[] = [];

  const MANAGED_AGENT_CONFIG = {
    cwd: "/srv/agents/cody",
    command: "claude",
    engine: "acp",
    agentCommand: "claude-agent-acp",
    stateDir: "/srv/agents/cody/acp-state",
  };

  function setManagedSandboxOnly(enabled: boolean) {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableEnvironments: true,
      enableManagedSandboxOnly: enabled,
    });
  }

  /** Every `Field` renders its label in a `<label>`, so this reads the form. */
  function fieldLabels(container: HTMLElement) {
    return Array.from(container.querySelectorAll("label")).map((label) => label.textContent?.trim() ?? "");
  }

  function choosePathButtons(container: HTMLElement) {
    return Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.trim() === "Choose",
    );
  }

  beforeEach(() => {
    mockAgentsApi.adapterModels.mockResolvedValue([]);
    mockAgentsApi.detectModel.mockResolvedValue(null);
    mockAgentsApi.list.mockResolvedValue([]);
    mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: null });
    mockInstanceSettingsApi.getGeneral.mockResolvedValue({ executionMode: "any" });
    mockEnvironmentsApi.capabilities.mockResolvedValue(SANDBOX_CAPABILITIES);
    mockSecretsApi.list.mockResolvedValue([]);
    mockSecretsApi.listProposals.mockResolvedValue([]);
    mockAgentsApi.getClaudeOAuthTokenStatus.mockResolvedValue(null);
    setManagedSandboxOnly(false);
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => {
        root.unmount();
      });
    }
    roots = [];
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows local host paths when the policy is off", async () => {
    const result = await renderForm(
      [makeEnvironment({ id: "local-1", name: "Local", driver: "local" })],
      { adapterType: "claude_local", adapterConfig: MANAGED_AGENT_CONFIG },
    );
    roots.push(result.root);

    await act(async () => {
      for (const button of result.container.querySelectorAll("button")) {
        if (["Advanced", "Advanced Run Policy"].includes(button.textContent?.trim() ?? "")) button.click();
      }
    });
    await flushReact();
    const labels = fieldLabels(result.container);
    expect(labels).toContain("Working directory (deprecated)");
    expect(labels).toContain("Command");
    expect(labels).not.toContain("Execution engine");
    expect(labels).not.toContain("ACP server command");
    expect(choosePathButtons(result.container).length).toBeGreaterThan(0);

    expect(labels).toContain("Agent instructions file");
  });

  it("hides the host path and execution-engine fields for claude_local when the policy is on", async () => {
    setManagedSandboxOnly(true);
    const result = await renderForm(
      [makeEnvironment({ id: "managed-1", name: "Managed", driver: "sandbox", config: { provider: "daytona" } })],
      { adapterType: "claude_local", adapterConfig: MANAGED_AGENT_CONFIG },
    );
    roots.push(result.root);

    await act(async () => {
      for (const button of result.container.querySelectorAll("button")) {
        if (["Advanced", "Advanced Run Policy"].includes(button.textContent?.trim() ?? "")) button.click();
      }
    });
    await flushReact();
    const labels = fieldLabels(result.container);

    expect(labels).not.toContain("ACP session mode");
    expect(labels).not.toContain("ACP non-interactive permissions");
    expect(labels).not.toContain("Working directory (deprecated)");
    expect(labels).not.toContain("Command");
    expect(labels).not.toContain("Execution engine");
    expect(labels).not.toContain("ACP server command");
    expect(labels).not.toContain("ACP state directory");
    expect(choosePathButtons(result.container)).toHaveLength(0);
    // The stored values stay untouched: hiding is presentation, and an import
    // that carries adapter configuration from another instance must still save.
    expect(result.container.textContent).not.toContain("/srv/agents/cody");
  });

  it("keeps the host-path fields hidden while the policy is still loading", async () => {
    // A cold cache resolves the policy to false on the first render. The gate
    // fails closed so a managed instance never flashes a stored host path.
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    const result = await renderForm(
      [makeEnvironment({ id: "local-1", name: "Local", driver: "local" })],
      { adapterType: "claude_local", adapterConfig: MANAGED_AGENT_CONFIG },
    );
    roots.push(result.root);

    await act(async () => {
      for (const button of result.container.querySelectorAll("button")) {
        if (["Advanced", "Advanced Run Policy"].includes(button.textContent?.trim() ?? "")) button.click();
      }
    });
    await flushReact();
    const labels = fieldLabels(result.container);
    expect(labels).not.toContain("Working directory (deprecated)");
    expect(labels).not.toContain("Command");
    expect(labels).not.toContain("Execution engine");
    expect(choosePathButtons(result.container)).toHaveLength(0);
    expect(result.container.textContent).not.toContain("/srv/agents/cody");
  });

  it("hides the command field and forces the instructions-file gate for codex_local when the policy is on", async () => {
    setManagedSandboxOnly(true);
    const result = await renderForm(
      [makeEnvironment({ id: "managed-1", name: "Managed", driver: "sandbox", config: { provider: "daytona" } })],
      { adapterType: "codex_local", adapterConfig: MANAGED_AGENT_CONFIG },
    );
    roots.push(result.root);

    await act(async () => {
      for (const button of result.container.querySelectorAll("button")) {
        if (["Advanced", "Advanced Run Policy"].includes(button.textContent?.trim() ?? "")) button.click();
      }
    });
    await flushReact();
    const labels = fieldLabels(result.container);
    expect(labels).not.toContain("Working directory (deprecated)");
    expect(labels).not.toContain("Command");
    expect(choosePathButtons(result.container)).toHaveLength(0);

    expect(labels).not.toContain("Agent instructions file");
  });
});

describe("subtractPersistedOverlay", () => {
  const overlayWith = (adapterConfig: Record<string, unknown>) => ({
    identity: {},
    adapterConfig,
    heartbeat: {},
    debug: {},
    runtime: {},
  });

  it("drops an entry whose value is structurally equal even with a new reference", () => {
    // An edit-then-restore rebuilds the env object, so a reference compare
    // would keep it falsely dirty after the refresh subtracts the snapshot —
    // a false "Unsaved changes" state and a redundant full-config save.
    const persisted = overlayWith({
      env: { CODEX_HOME: { type: "secret_ref", secretId: "s-1", version: "latest" } },
    });
    const current = overlayWith({
      env: { CODEX_HOME: { type: "secret_ref", secretId: "s-1", version: "latest" } },
    });
    expect(subtractPersistedOverlay(current, persisted).adapterConfig).toEqual({});
  });

  it("keeps an entry the user changed after the snapshot", () => {
    const persisted = overlayWith({
      env: { CODEX_HOME: { type: "secret_ref", secretId: "s-1", version: "latest" } },
    });
    const current = overlayWith({
      env: {
        CODEX_HOME: { type: "secret_ref", secretId: "s-1", version: "latest" },
        EXTRA: { type: "plain", value: "added-during-save" },
      },
    });
    expect(subtractPersistedOverlay(current, persisted).adapterConfig).toEqual({
      env: {
        CODEX_HOME: { type: "secret_ref", secretId: "s-1", version: "latest" },
        EXTRA: { type: "plain", value: "added-during-save" },
      },
    });
  });

  it("keeps an entry the snapshot never carried", () => {
    const persisted = overlayWith({});
    const current = overlayWith({ model: "gpt-5.5" });
    expect(subtractPersistedOverlay(current, persisted).adapterConfig).toEqual({
      model: "gpt-5.5",
    });
  });

  it("compares arrays structurally", () => {
    const persisted = overlayWith({ args: ["--flag", "value"] });
    const equal = overlayWith({ args: ["--flag", "value"] });
    const changed = overlayWith({ args: ["--flag", "other"] });
    expect(subtractPersistedOverlay(equal, persisted).adapterConfig).toEqual({});
    expect(subtractPersistedOverlay(changed, persisted).adapterConfig).toEqual({
      args: ["--flag", "other"],
    });
  });
});
