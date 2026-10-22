import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { AdapterEnvironmentTestResult, Agent, EnvBinding } from "@paperclipai/shared";
import { ADAPTER_AUTH_MISSING_CHECK_CODE } from "@paperclipai/shared";
import { useNavigate, useSearchParams } from "@/lib/router";
import { agentsApi } from "@/api/agents";
import { ApiError } from "@/api/client";
import { adaptersApi } from "@/api/adapters";
import { environmentsApi } from "@/api/environments";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { secretsApi } from "@/api/secrets";
import { useCompany } from "@/context/CompanyContext";
import { useDialogActions } from "@/context/DialogContext";
import { queryKeys } from "@/lib/queryKeys";
import { agentUrl } from "@/lib/utils";
import { getUIAdapter } from "@/adapters";
import { resolveAdapterTestEnvironmentId, resolveLocalDefaultEnvironmentId, resolveManagedSandboxEnvironmentId } from "@/lib/adapter-test-environment";
import { resolveForcedKubernetesEnvironment } from "@/lib/forced-kubernetes-environment";
import { environmentDisplayLabel } from "@/lib/managed-sandbox-environment";
import { buildNewAgentRuntimeConfig } from "@/lib/new-agent-runtime-config";
import { PROVIDER_CREDENTIAL_ENV_KEYS, storeOrganizationApiKey } from "@/lib/provider-credential";
import { testAgentSetup } from "@/lib/test-agent-setup";
import { useAgentAppearanceDraft } from "../../hooks/useAgentAppearanceDraft";
import { defaultCreateValues } from "../agent-config-defaults";
import { AgentCharacter } from "../AgentCharacter";
import { Field } from "../agent-config-primitives";
import { SecretPicker } from "../environment-variables-editor/SecretPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { nativeSelectClassName } from "../ui/select";
import { RuntimeTestCard, type TestState } from "../RuntimeTestCard";
import { AgentBasicsDialog } from "./AgentBasicsDialog";

const blocking = (result: AdapterEnvironmentTestResult) => result.status === "fail"
  || result.checks.some(check => check.code === ADAPTER_AUTH_MISSING_CHECK_CODE);

export function NewAgentSetup() {
  const { selectedCompanyId } = useCompany();
  const [params] = useSearchParams();
  if (!selectedCompanyId) return <p className="text-sm text-muted-foreground">Выберите организацию для создания агента.</p>;
  return <Setup key={`${selectedCompanyId}:${params.get("name")}`} companyId={selectedCompanyId}
    name={params.get("name") ?? ""} createdAgentId={params.get("createdAgentId")} setupAgentId={params.get("setupAgentId")} />;
}

function Setup({ companyId, name, createdAgentId, setupAgentId }: {
  companyId: string; name: string; createdAgentId: string | null; setupAgentId: string | null;
}) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const { openNewIssue } = useDialogActions();
  const appearanceDraft = useAgentAppearanceDraft(`${companyId}:new-agent`);
  const [localBaseUrl, setLocalBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerBinding, setProviderBinding] = useState<EnvBinding | null>(null);
  const [environmentOverride, setEnvironmentOverride] = useState("");
  const [createdInSession, setCreated] = useState<Agent | null>(null);
  const setupId = useRef(setupAgentId ?? crypto.randomUUID());
  if (setupAgentId) setupId.current = setupAgentId;
  const creating = useRef(false);
  const restored = useRef<string | null>(null);
  const [creationAttempt, setCreationAttempt] = useState(0);
  const recordId = createdAgentId ?? setupAgentId;
  const currentCreated = !recordId || createdInSession?.id === recordId ? createdInSession : null;
  const savedAgent = useQuery({
    queryKey: queryKeys.agents.detail(recordId ?? "new"),
    queryFn: () => agentsApi.get(recordId!, companyId),
    enabled: Boolean(recordId) && !currentCreated && !creating.current,
    retry: false,
  });
  const created = currentCreated ?? (savedAgent.data?.companyId === companyId ? savedAgent.data : null);
  const completed = Boolean(created && created.pauseReason !== "setup");
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<TestState | "warn">("idle");
  const [result, setResult] = useState<AdapterEnvironmentTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  const resetTest = () => { generation.current++; setResult(null); setTestState("idle"); setError(null); };

  const adapters = useQuery({ queryKey: queryKeys.adapters.all, queryFn: () => adaptersApi.list() });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId) });
  const envs = useQuery({ queryKey: queryKeys.environments.list(companyId), queryFn: () => environmentsApi.list(companyId) });
  const settings = useQuery({ queryKey: queryKeys.instance.settings, queryFn: instanceSettingsApi.get });
  const experimental = useQuery({ queryKey: queryKeys.instance.experimentalSettings, queryFn: instanceSettingsApi.getExperimental });
  const general = useQuery({ queryKey: queryKeys.instance.generalSettings, queryFn: instanceSettingsApi.getGeneral });
  const companySecrets = useQuery({ queryKey: queryKeys.secrets.list(companyId), queryFn: () => secretsApi.list(companyId) });
  const forced = resolveForcedKubernetesEnvironment(general.data?.executionMode, envs.data ?? []);
  const managedOnly = experimental.data?.enableManagedSandboxOnly === true;
  let environmentId: string | null = null;
  let environmentError: string | null = null;
  try {
    environmentId = forced.forced ? forced.kubernetesEnvironment?.id ?? null : resolveAdapterTestEnvironmentId({
      agentDefaultEnvironmentId: environmentOverride || null,
      instanceDefaultEnvironmentId: settings.data?.defaultEnvironmentId ?? null,
      localDefaultEnvironmentId: resolveLocalDefaultEnvironmentId(envs.data ?? []),
      managedSandboxOnly: managedOnly,
      managedSandboxEnvironmentId: resolveManagedSandboxEnvironmentId(envs.data ?? []),
      visibleEnvironmentIds: (envs.data ?? []).map(env => env.id),
    });
  } catch (cause) { environmentError = cause instanceof Error ? cause.message : "Не удалось выбрать среду выполнения."; }
  const environment = envs.data?.find(env => env.id === environmentId);
  const environmentKey = JSON.stringify([companyId, environmentId, environment?.config]);
  useEffect(() => { resetTest(); }, [environmentKey]);
  const available = adapters.data?.some(adapter => adapter.type === "pi_local" && adapter.loaded && !adapter.disabled);
  const setupError = adapters.error ?? agents.error ?? envs.error ?? settings.error ?? experimental.error ?? general.error;
  const settingsReady = Boolean(available && !setupError && !environmentError && envs.isSuccess && settings.isSuccess
    && experimental.isSuccess && general.isSuccess && agents.isSuccess && (!(managedOnly || forced.forced) || environmentId));
  const ready = Boolean(created) && settingsReady && !envs.isFetching && !settings.isFetching
    && !experimental.isFetching && !general.isFetching;
  const busy = testState === "running" || saving;
  const requestedEnvironmentId = environmentOverride || (forced.forced || managedOnly ? environmentId : null);

  function buildConfig(): Record<string, unknown> {
    const saved = created?.adapterType === "pi_local" ? created.adapterConfig ?? {} : {};
    const config = { ...saved, ...getUIAdapter("pi_local").buildAdapterConfig({
      ...defaultCreateValues, adapterType: "pi_local", runner: "legacy", resolvedRunner: "legacy",
      model, adapterSchemaValues: { baseUrl: localBaseUrl.trim() },
    }) };
    // Credentials belong to the selected endpoint; saved vendor bindings never migrate implicitly.
    const env = { ...((saved.env as Record<string, EnvBinding>) ?? {}) };
    for (const key of PROVIDER_CREDENTIAL_ENV_KEYS) delete env[key];
    delete env.OPENAI_API_KEY;
    if (providerBinding) env.OPENAI_API_KEY = providerBinding;
    const modelId = model.trim().replace(/^local\//, "");
    return { ...config, provider: undefined, acpxAgent: undefined, piThinkingLevel: undefined,
      baseUrl: localBaseUrl.trim(), model: modelId ? `local/${modelId}` : "", env };
  }
  function preparedConfig() {
    if (!model.trim().replace(/^local\//, "")) throw new Error("Укажите идентификатор модели.");
    try {
      const url = new URL(localBaseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { throw new Error("Укажите URL API с http:// или https://, без логина, параметров и фрагмента."); }
    return buildConfig();
  }
  const pendingCredentials = (): Record<string, string> => apiKey.trim() ? { OPENAI_API_KEY: apiKey.trim() } : {};

  useEffect(() => {
    if (!name || !settingsReady || createdAgentId || created || creating.current || (setupAgentId && !savedAgent.isError)) return;
    if (savedAgent.error && (!(savedAgent.error instanceof ApiError) || savedAgent.error.status !== 404)) return;
    creating.current = true;
    setError(null);
    navigate(`/agents/new?${new URLSearchParams({ name, adapterType: "pi_local", runner: "legacy", setupAgentId: setupId.current })}`, { replace: true });
    const existing = agents.data ?? [];
    const leader = existing.find(agent => agent.role === "ceo" && agent.status !== "terminated");
    void agentsApi.create(companyId, {
      setupId: setupId.current, name, appearance: appearanceDraft.appearance,
      role: existing.length ? "general" : "ceo", ...(leader ? { reportsTo: leader.id } : {}),
      adapterType: "pi_local", runner: "legacy", adapterConfig: {}, defaultEnvironmentId: requestedEnvironmentId,
      runtimeConfig: buildNewAgentRuntimeConfig({ heartbeatEnabled: false }),
    }).then(agent => {
      setCreated(agent);
      cache.setQueryData(queryKeys.agents.detail(agent.id), agent);
      void cache.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    }).catch(cause => setError(cause instanceof Error ? cause.message : "Не удалось создать агента."))
      .finally(() => { creating.current = false; });
  }, [name, companyId, settingsReady, creationAttempt, createdAgentId, setupAgentId, savedAgent.isError, created]);

  useEffect(() => {
    if (!savedAgent.data || restored.current === savedAgent.data.id || savedAgent.data.companyId !== companyId) return;
    restored.current = savedAgent.data.id;
    const agent = savedAgent.data;
    const config = agent.adapterConfig;
    const local = agent.adapterType === "pi_local" && typeof config.baseUrl === "string" && Boolean(config.baseUrl.trim());
    setLocalBaseUrl(local ? config.baseUrl as string : "");
    setModel(typeof config.model === "string" ? config.model : "");
    setEnvironmentOverride(agent.defaultEnvironmentId ?? "");
    const credential = (config.env as Record<string, unknown> | undefined)?.OPENAI_API_KEY;
    if (local && !agent.runtimeConfig.aiConnection && credential && typeof credential === "object" && "type" in credential
      && ["secret_ref", "user_secret_ref"].includes(String(credential.type))) setProviderBinding(credential as EnvBinding);
  }, [savedAgent.data, companyId]);

  async function saveDraft(exit = false, testedConfig?: Record<string, unknown>) {
    if (!created || completed) return;
    const runtimeConfig = { ...created.runtimeConfig };
    delete runtimeConfig.aiConnection;
    const config = testedConfig ?? buildConfig();
    const staged: Array<{ remove: () => Promise<unknown> }> = [];
    let submitted = false;
    const rememberCredentials = () => {
      if (!staged.length) return;
      setApiKey("");
      setProviderBinding((config.env as Record<string, EnvBinding>).OPENAI_API_KEY);
    };
    try {
      for (const [key, value] of Object.entries(pendingCredentials())) {
        const secret = await storeOrganizationApiKey(companyId, key, value);
        staged.push(secret);
        config.env = { ...((config.env as object) ?? {}), [key]: secret.binding };
      }
      submitted = true;
      const agent = await agentsApi.update(created.id, {
        adapterType: "pi_local", runner: "legacy", adapterConfig: config, replaceAdapterConfig: true,
        defaultEnvironmentId: requestedEnvironmentId, runtimeConfig,
      }, companyId);
      rememberCredentials();
      setCreated(agent);
      cache.setQueryData(queryKeys.agents.detail(agent.id), agent);
      if (exit) navigate("/agents/all");
      return agent;
    } catch (cause) {
      if (submitted && !(cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408)) {
        rememberCredentials();
      } else {
        try { await Promise.all(staged.map(secret => secret.remove())); }
        catch { throw new Error(`${cause instanceof Error ? cause.message : "Не удалось сохранить настройку агента."} Не удалось удалить неиспользованный ключ из секретов.`); }
      }
      throw cause;
    }
  }
  async function saveAndExit() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try { await saveDraft(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройку агента."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function runTest(): Promise<Record<string, unknown> | null> {
    if (!ready) return null;
    const run = ++generation.current;
    setTestState("running"); setResult(null); setError(null);
    try {
      const config = preparedConfig();
      const tested = await testAgentSetup({ companyId, adapterType: "pi_local", providerAdapter: "pi_local", runner: "legacy",
        adapterConfig: config, testCredentials: pendingCredentials(), environmentId });
      if (run !== generation.current) return null;
      setResult(tested); setTestState(blocking(tested) ? "fail" : tested.status);
      return blocking(tested) ? null : config;
    } catch (cause) {
      if (run === generation.current) { setError(cause instanceof Error ? cause.message : "Не удалось проверить агента."); setTestState("fail"); }
      return null;
    }
  }
  async function finish() {
    if (savingRef.current || completed || !created || !ready || !name.trim() || testState === "running" || testState === "fail") return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const config = testState === "idle" || apiKey.trim() ? await runTest() : preparedConfig();
      if (!config) return;
      if (apiKey.trim()) await saveDraft(false, config);
      const runtimeConfig = { ...created.runtimeConfig, ...buildNewAgentRuntimeConfig({ heartbeatEnabled: false }) };
      delete runtimeConfig.aiConnection;
      const response = await agentsApi.hire(companyId, {
        setupAgentId: created.id, name: created.name, appearance: created.appearance ?? appearanceDraft.appearance,
        role: created.role, reportsTo: created.reportsTo, adapterType: "pi_local", runner: "legacy", adapterConfig: config,
        defaultEnvironmentId: requestedEnvironmentId, runtimeConfig, budgetMonthlyCents: 0,
      });
      setApiKey(""); setCreated(response.agent); appearanceDraft.clear();
      navigate(`/agents/new?${new URLSearchParams({ name: response.agent.name, adapterType: "pi_local", runner: "legacy", createdAgentId: response.agent.id })}`, { replace: true });
      cache.setQueryData(queryKeys.agents.detail(response.agent.id), response.agent);
      await Promise.all([cache.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) }), cache.invalidateQueries({ queryKey: queryKeys.approvals.list(companyId) })]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось завершить настройку агента."); }
    finally { void cache.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) }); savingRef.current = false; setSaving(false); }
  }

  if (recordId && !created && !creating.current && savedAgent.error && !(savedAgent.error instanceof ApiError && savedAgent.error.status === 404))
    return <p role="alert" className="text-sm text-destructive">Не удалось загрузить агента. {savedAgent.error.message}</p>;
  if (!name || created?.metadata?.setupAdapterPending === true) return <AgentBasicsDialog open initialName={created?.name ?? name}
    setupAgentId={created?.metadata?.setupAdapterPending ? created.id : setupAgentId ?? undefined} onClose={() => navigate("/agents/all")}
    onContinue={basics => navigate(`/agents/new?${new URLSearchParams(basics)}`, { replace: true })} />;
  if (!created && settingsReady) return <div className="space-y-4">
    <p role={error ? "alert" : "status"}>{error ?? "Создаём агента…"}</p>
    {error && <Button onClick={() => setCreationAttempt(value => value + 1)}>Повторить</Button>}
  </div>;

  const confirmationModel = String(created?.adapterConfig?.model ?? model).replace(/^local\//, "");
  const environmentLabel = environment ? environmentDisplayLabel(environment) : "Этот компьютер";
  return <div className="mx-auto flex max-w-5xl flex-col gap-8 py-6">
    <header className="flex items-center gap-4">
      <AgentCharacter appearance={created?.appearance ?? appearanceDraft.appearance} size={256} className="size-48" trackingScope="page"
        state={completed || testState === "pass" ? "success" : testState === "running" ? "loading" : "sleepy"} muted={!completed && testState !== "pass"} />
      <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="text-sm text-muted-foreground">Локальный / корпоративный API</p></div>
    </header>
    {environmentError && !envs.isPending && <p role="alert" className="text-sm text-destructive">{environmentError}</p>}
    {setupError && <p role="alert" className="text-sm text-destructive">{setupError.message}</p>}
    {adapters.data && !available && <p role="alert" className="text-sm text-destructive">Локальный движок Pi недоступен.</p>}
    {(managedOnly || forced.forced) && !envs.isPending && !environmentId && <p role="alert" className="text-sm text-destructive">Нет доступной среды выполнения.</p>}
    {completed && created ? <section className="space-y-6">
      <h2 className="text-xl font-semibold">{created.status === "pending_approval" ? "Агент ожидает одобрения" : "Агент готов к работе"}</h2>
      <dl className="space-y-3"><div><dt className="text-sm text-muted-foreground">Модель</dt><dd>{confirmationModel}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Среда выполнения</dt><dd>{environmentLabel}</dd></div></dl>
      <div className="flex gap-3"><Button variant="outline" onClick={() => navigate(`${agentUrl(created)}/runtime`)}>Открыть агента</Button>
        <Button disabled={created.status === "pending_approval"} onClick={() => openNewIssue({ assigneeAgentId: created.id, status: "todo" })}>Назначить задачу</Button></div>
    </section> : <form className="space-y-8" onSubmit={event => { event.preventDefault(); void finish(); }}>
      <h2 className="text-xl font-semibold">Настройка агента</h2>
      <fieldset disabled={busy} className="space-y-5">
        <Field label="URL API" hint="Адрес OpenAI-совместимого API, включая /v1. Ключ можно оставить пустым, если сервер работает без авторизации.">
          <Input aria-label="URL API" type="url" value={localBaseUrl} placeholder="http://localhost:11434/v1"
            onChange={event => { setLocalBaseUrl(event.target.value); setApiKey(""); setProviderBinding(null); resetTest(); }} />
        </Field>
        <Field label="Ключ API (необязательно)"><div className="flex items-center gap-3">
          <Input aria-label="OPENAI_API_KEY" type="password" autoComplete="off" value={apiKey}
            placeholder={providerBinding ? "Используется сохранённый ключ" : "Без ключа"}
            onChange={event => { setApiKey(event.target.value); setProviderBinding(null); resetTest(); }} />
          <SecretPicker secrets={companySecrets.data ?? []} secretId={providerBinding && typeof providerBinding === "object" && providerBinding.type === "secret_ref" ? providerBinding.secretId : ""} onSelect={secretId => {
            setProviderBinding({ type: "secret_ref", secretId, version: "latest" }); setApiKey(""); resetTest();
          }} />
        </div><p className="mt-2 text-xs text-muted-foreground">Ключ хранится в секретах организации.</p></Field>
        <Field label="Модель"><Input aria-label="Модель" value={model.replace(/^local\//, "")} placeholder="qwen3-coder:30b"
          onChange={event => { setModel(event.target.value); resetTest(); }} /></Field>
        {!forced.forced && (envs.data?.length ?? 0) > 1 && <Field label="Среда выполнения">
          <select aria-label="Среда выполнения" className={nativeSelectClassName} value={environmentOverride}
            onChange={event => { setEnvironmentOverride(event.target.value); resetTest(); }}>
            <option value="">По умолчанию: {environmentLabel}</option>
            {(envs.data ?? []).filter(env => env.status === "active" && (!managedOnly || env.driver !== "local")).map(env =>
              <option key={env.id} value={env.id}>{environmentDisplayLabel(env)}</option>)}
          </select>
        </Field>}
      </fieldset>
      <RuntimeTestCard variant="connection" state={testState} result={result} error={error} disabled={!ready || busy} onTest={() => void runTest()} />
      {error && testState !== "fail" && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-between border-t border-border py-5">
        <Button type="button" variant="ghost" disabled={!ready || busy} onClick={() => void saveAndExit()}>Сохранить и выйти</Button>
        <Button type="submit" disabled={!ready || busy || testState === "fail"}>{saving ? "Сохранение…" : "Завершить настройку"}<Check className="size-4" /></Button>
      </div>
    </form>}
  </div>;
}
