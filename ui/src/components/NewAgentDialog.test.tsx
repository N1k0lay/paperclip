// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewAgentDialog } from "./NewAgentDialog";
import { queryKeys } from "@/lib/queryKeys";
vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: {
    getExperimental: async () => ({ enableNativeRunner: true }),
  },
}));
const agents = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock("@/api/agents", () => ({ agentsApi: agents }));
const invites = vi.hoisted(() => ({ createCompanyInvite: vi.fn(), getInviteOnboarding: vi.fn(), copy: vi.fn() }));
vi.mock("../api/access", () => ({ accessApi: invites }));
vi.mock("../lib/clipboard", () => ({ copyTextToClipboard: invites.copy }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
const dotApi = vi.hoisted(() => ({ create: vi.fn(), connection: vi.fn(), pair: vi.fn(), retry: vi.fn() }));
vi.mock("@/api/dotInvitations", () => ({ dotInvitationsApi: dotApi }));
const state = vi.hoisted(() => ({
  adapters: [] as object[],
  navigate: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/router", () => ({ useNavigate: () => state.navigate, Link: ({ to, children }: any) => createElement("a", { href: to }, children) }));
vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({ newAgentOpen: true, closeNewAgent: state.close }),
}));
vi.mock("@/api/adapters", () => ({
  adaptersApi: { list: async () => state.adapters },
}));
vi.mock("./onboarding/PillGuy", () => ({ PillGuy: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
beforeEach(async () => {
  vi.clearAllMocks();
  const rows = new Map();
  Object.values(agents).forEach(mock => mock.mockReset());
  agents.list.mockResolvedValue([]);
  agents.create.mockImplementation(async (_company, input) => {
    const record = { ...input, id: input.setupId, pauseReason: "setup" };
    rows.set(record.id, record);
    return record;
  });
  agents.get.mockImplementation(async id => rows.get(id));
  agents.update.mockImplementation(async (id, input) => {
    const record = { ...rows.get(id), ...input, id };
    rows.set(id, record);
    return record;
  });
  Object.values(dotApi).forEach(mock => mock.mockReset());
  invites.createCompanyInvite.mockResolvedValue({ token: "one-time-token", onboardingTextPath: "/api/invites/one-time-token/onboarding.txt" });
  invites.getInviteOnboarding.mockResolvedValue({ onboarding: { connectivity: {} } });
  invites.copy.mockResolvedValue(undefined);
  state.adapters = [
    { type: "codex_local", loaded: true },
    { type: "paperclip_runner", loaded: true },
    { type: "claude_local", loaded: true, disabled: true },
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={cache}>
        <NewAgentDialog />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
  container.remove();
});
async function name(value = "Ada & Co") {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Например, Алексей"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Настроить агента");
}

it("requires a name and opens only local API setup", async () => {
  await click("Настроить агента");
  expect(state.navigate).not.toHaveBeenCalled();
  await name();
  expect(state.close).toHaveBeenCalledTimes(1);
  const query = new URL(state.navigate.mock.calls[0][0], "http://local").searchParams;
  expect(query.get("name")).toBe("Ada & Co");
  expect(query.get("adapterType")).toBe("pi_local");
  expect(query.get("runner")).toBe("legacy");
  expect(query.get("runnerProvider")).toBe("pi");
  expect(document.querySelector('input[name="new-agent-adapter"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Пригласить внешнего агента");
});

it("saves a company-scoped Pi draft before navigating without URL or model", async () => {
  await name();
  expect(agents.create).toHaveBeenCalledTimes(1);
  const input = agents.create.mock.calls[0][1];
  expect(agents.create.mock.calls[0][0]).toBe("company-1");
  expect(input).toMatchObject({ name: "Ada & Co", role: "ceo", adapterType: "pi_local", runner: "legacy", adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false } } });
  const query = new URL(state.navigate.mock.calls[0][0], "http://local").searchParams;
  expect(query.get("setupAgentId")).toBe(input.setupId);
  expect(agents.update).not.toHaveBeenCalled();
});

it("retries a failed name save with the same identity", async () => {
  agents.create.mockRejectedValueOnce(new Error("Creation unavailable"));
  await name();
  expect(document.body.textContent).toContain("Creation unavailable");
  expect(state.navigate).not.toHaveBeenCalled();
  await click("Настроить агента");
  expect(agents.create).toHaveBeenCalledTimes(2);
  expect(agents.create.mock.calls[1][1].setupId).toBe(agents.create.mock.calls[0][1].setupId);
  expect(state.navigate).toHaveBeenCalledTimes(1);
});

it("ignores repeated submission while the draft is being saved", async () => {
  let finish!: (value: object) => void;
  agents.create.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await name();
  const input = agents.create.mock.calls[0][1];
  await act(async () => {
    const form = document.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(agents.create).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...input, id: input.setupId }));
  expect(state.navigate).toHaveBeenCalledTimes(1);
});

it("does not navigate after closing while draft creation is pending", async () => {
  let finish!: (value: object) => void;
  agents.create.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await name();
  const input = agents.create.mock.calls[0][1];
  await act(async () => root.render(null));
  await act(async () => finish({ ...input, id: input.setupId }));
  expect(state.navigate).not.toHaveBeenCalled();
});

it("keeps the server-assigned name when a duplicate is numbered", async () => {
  agents.create.mockImplementationOnce(async (_company, input) => ({ ...input, id: input.setupId, name: "Ada & Co 2" }));
  await name();
  expect(agents.update).not.toHaveBeenCalled();
  const query = new URL(state.navigate.mock.calls[0][0], "http://local").searchParams;
  expect(query.get("name")).toBe("Ada & Co 2");
});

it("reports to the existing leader when creating a later agent", async () => {
  agents.list.mockResolvedValue([{ id: "leader", role: "ceo", status: "idle" }]);
  await name();
  expect(agents.create.mock.calls[0][1]).toMatchObject({ role: "general", reportsTo: "leader", adapterType: "pi_local", runner: "legacy" });
});

it("cancels before creating any draft", async () => {
  await click("Отмена");
  expect(state.close).toHaveBeenCalledTimes(1);
  expect(agents.create).not.toHaveBeenCalled();
  expect(state.navigate).not.toHaveBeenCalled();
});
