import { COPILOT_MODEL_DISCOVERY_QUERY_OPTIONS } from "@/lib/copilot-task-model-catalog";
import type { AgentRunner, AgentRunnerChoice } from "@paperclipai/shared";
import { needsClaudeSetupQualification, qualifyClaudeSetup } from "../lib/qualify-claude-setup";
import { agentHarnessType } from "@paperclipai/shared";
import { adaptersApi, type AdapterInfo } from "../api/adapters";
import { healthApi } from "@/api/health";
import { useLocalAiLogin } from "./ai-connections/useLocalAiLogin";
import { aiConnectionsApi } from "@/api/ai-connections";
import { AiConnectionField, aiProviderForAdapter } from "./ai-connections/AiConnectionField";
import { PAPERCLIP_RUNNER_ACPX_PROFILES } from "@paperclipai/adapter-utils";
import { aiConnectionBindingSchema } from "@paperclipai/shared";
import type { AiConnectionBinding } from "@paperclipai/shared";
import { storeProviderApiKey } from "../lib/provider-credential";
import { useSavedProviderKeys } from "./onboarding/SavedProviderKeySelect";
import { randomAgentAppearance, resolveAgentAppearance, agentAppearanceSchema } from "@paperclipai/shared";
import { OnboardingCharacter } from "./onboarding/OnboardingCharacter";
import { useEffect, useState, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type {
  AdapterEnvironmentTestResult,
  Agent,
  AgentRole,
  ClaudeOAuthTokenStatusResponse,
  Environment,
  InstanceSettings,
} from "@paperclipai/shared";
import { AGENT_ROLES, AGENT_ROLE_LABELS, ADAPTER_AUTH_MISSING_CHECK_CODE } from "@paperclipai/shared";
import { AdapterLoginPanel } from "./AgentConfigForm";
import {
  CONNECT_SOURCE_NAMES,
  OnboardingCardField,
  OnboardingLoginCard,
} from "./AdapterLoginChrome";
import {
  beatDelay,
  CARD_ENTER,
  CARD_EXIT,
  CARD_EXIT_MS,
  CONNECTED_HOLD_MS,
  MAKE_ROOM,
  MAKE_ROOM_MS,
  SOURCE_COLLAPSE_MS,
  SOURCE_LINK_EXIT,
} from "./onboarding/onboarding-motion";

/**
 * Where the connect step's sign-in sequence is. Space and visibility land on
 * different beats, which is why there are more of these than there are things
 * on screen — see the derived state in the step itself.
 */
type ConnectPhase =
  | "idle"
  | "collapsing"
  | "loading"
  | "ready"
  | "waiting"
  | "connecting"
  | "unwindCard"
  | "unwindRoom"
  | "unwindRow";
import { secretsApi } from "../api/secrets";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useLocation, useNavigate, useParams } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { ApiError } from "../api/client";
import { companiesApi } from "../api/companies";
import { useCompanyListQuery } from "../api/companies-query";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { environmentsApi } from "../api/environments";
import { instanceSettingsApi } from "../api/instanceSettings";
import {
  resolveAdapterTestEnvironmentId,
  resolveLocalDefaultEnvironmentId,
  resolveManagedSandboxEnvironmentId,
} from "../lib/adapter-test-environment";
import { queryKeys } from "../lib/queryKeys";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import {
  extractModelName,
  extractProviderIdWithFallback
} from "../lib/model-utils";
import { getUIAdapter } from "../adapters";
import { listUIAdapters } from "../adapters";
import { isVisualAdapterChoice } from "../adapters/metadata";
import { useDisabledAdaptersSync, useAdapterRegistryLoaded } from "../adapters/use-disabled-adapters";
import { useAdapterCapabilities } from "../adapters/use-adapter-capabilities";
import { getAdapterDisplay } from "../adapters/adapter-display-registry";
import { buildFixedClaudeOAuthBinding, CLAUDE_OAUTH_TOKEN_ENV_KEY } from "./environment-variables-editor/model";
import { defaultCreateValues } from "./agent-config-defaults";
import { restoreOnboardingState } from "../lib/onboarding-state";
import {
  buildOnboardingIssuePayload,
  buildOnboardingProjectPayload,
  selectDefaultCompanyGoalId,
  selectReusableOnboardingProject,
} from "../lib/onboarding-launch";
import { buildNewAgentRuntimeConfig } from "../lib/new-agent-runtime-config";
import { DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX } from "@paperclipai/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@paperclipai/adapter-cursor-local";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "@paperclipai/adapter-gemini-local";
import { DEFAULT_KIMI_LOCAL_MODEL } from "@paperclipai/adapter-kimi-local";
import { DEFAULT_OPENCODE_LOCAL_MODEL, isValidOpenCodeModelId } from "@paperclipai/adapter-opencode-local";
import {
  canGoBackFromOnboardingStep,
  canJumpToOnboardingStep,
  companyPrefixFromOnboardingPath,
  resolveRouteOnboardingOptions,
} from "../lib/onboarding-route";
import { useCloudInstance } from "../hooks/useCloudInstance";
import { PillGuy } from "./onboarding/PillGuy";
import { SleepingZs } from "./onboarding/SleepingZs";
import {
  AGENT_ARC_WIZARD_STEPS,
  ONBOARDING_STEP_LABELS,
  ONBOARDING_WIZARD_STEPS,
  Stepper,
  agentArcStepFor,
  onboardingStepPositionFor,
} from "./onboarding/Stepper";
import { AgentPreview } from "./onboarding/AgentPreview";
import type { CredentialMode } from "./onboarding/ModelSourceTiles";
import { PaperclipLockup } from "./PaperclipLockup";
import { FooterNav, type FooterPrimaryIcon } from "./onboarding/FooterNav";
import { OnboardingHeading } from "./onboarding/OnboardingPrimitives";
import { DEFAULT_AGENT_ROLE } from "../lib/onboarding-agent-role";
import { capsuleHeroMotion, capsuleRoomEnter, capsuleRoomExit, heroRoomArrival, heroRoomMotion, ledeMotion, stepContentMotion, titleSwapMotion } from "./onboarding/onboarding-motion";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  ChevronDown,
} from "lucide-react";

type Step = 0 | 1 | 2 | 3 | 4 | 5;
// Plugin/external adapters use arbitrary type ids, so this mirrors the master
// wizard's registry-driven approach rather than a fixed union.
type AdapterType = string;

// Only the qualified Copilot profile is offered through Runner in onboarding.
// Other Runner profiles remain explicit agent configuration choices.
const ONBOARDING_EXCLUDED_ADAPTER_TYPES = new Set([
  "process",
  "http",
  "paperclip_runner",
]);

const copilotOnboardingQualified = PAPERCLIP_RUNNER_ACPX_PROFILES.some(
  (profile) => profile.value === "copilot" && profile.qualified,
);


/**
 * True when an adapter-test result blocks a hire. A `fail` status always
 * blocks. A `warn` or a `pass` status blocks too when a check reports
 * `ADAPTER_AUTH_MISSING_CHECK_CODE`. That check means the agent has no
 * working authentication, so it cannot run. A `warn` with no such check
 * still lets the hire proceed. The wizard widened the gate for missing
 * authentication only, not for every other warning.
 */
function blocksAgentCreate(result: AdapterEnvironmentTestResult): boolean {
  if (result.status === "fail") return true;
  return result.checks.some((check) => check.code === ADAPTER_AUTH_MISSING_CHECK_CODE);
}

/** True when `value` is a plain object, so callers can spread it as env config. */
function isEnvRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ANTHROPIC_API_KEY_ENV_KEY = "ANTHROPIC_API_KEY";

/**
 * True when the adapter configuration carries a non-empty ANTHROPIC_API_KEY.
 * The server rejects that key together with the fixed Claude login binding
 * (see `assertClaudeOAuthBindingInvariant` in `server/src/services/secrets.ts`).
 * This checks the built configuration first, so onboarding never sends a
 * hire the server would reject.
 */
function adapterConfigHasAnthropicApiKey(config: Record<string, unknown>): boolean {
  if (!isEnvRecord(config.env)) return false;
  const binding = config.env[ANTHROPIC_API_KEY_ENV_KEY];
  if (typeof binding === "string") return binding.trim().length > 0;
  if (!isEnvRecord(binding)) return false;
  if (binding.type === "plain") {
    return typeof binding.value === "string" && binding.value.trim().length > 0;
  }
  return binding.type === "secret_ref" || binding.type === "user_secret_ref";
}

/**
 * The environment variable each source reads its key from.
 *
 * Named rather than described in the field above it, because the customer knows
 * which key they are holding and does not know where this step will put it. The
 * mapping already existed in this file as prose inside the environment-check
 * hint; this is the same knowledge, in a form the key field can use.
 */
const API_KEY_ENV_KEYS: Record<string, string> = {
  claude_local: ANTHROPIC_API_KEY_ENV_KEY,
  codex_local: "OPENAI_API_KEY",
  pi_local: "OPENAI_API_KEY",
  paperclip_runner: "COPILOT_GITHUB_TOKEN",
};

function apiKeyEnvKeyFor(adapterType: string): string {
  return API_KEY_ENV_KEYS[adapterType] ?? "API_KEY";
}

// Exported so tests write/read the exact key the component uses, instead of
// duplicating the literal and silently drifting from it if it's ever renamed.
export const ONBOARDING_STORAGE_KEY = "paperclip-onboarding-state";
const DEFAULT_TASK_TITLE = "Знакомство со Сказом";
/**
 * The onboarding draft in `localStorage`, via a browser that is allowed to say
 * no.
 *
 * Storage access throws outright where a browser denies it — Safari's private
 * mode, a blocked third-party context — and every call site here sits in a
 * render, an effect, or a close handler, so an escaping exception takes down
 * something the customer was using. Losing the ability to resume onboarding is
 * a far smaller failure than the wizard tearing down mid-answer, or refusing
 * to close.
 *
 * Routed through one object on purpose. Guarding these one at a time is how
 * three of the four call sites ended up unguarded while the fourth looked
 * fixed: the read, the stale-blob cleanup, the persist effect, and `reset()`
 * all have the same failure and want the same answer.
 */
const onboardingDraftStorage = {
  read(): string | null {
    try {
      return window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(value: string): void {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, value);
    } catch {
      // Storage unavailable: the draft is simply not resumable this session.
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
      // Nothing to do. A draft that cannot be cleared is re-rejected on the
      // next load by the same ownership check that rejected it here.
    }
  },
};

const INCOMPLETE_ONBOARDING_STATE_MESSAGE =
  "Настройка не завершена. Откройте её заново и повторите попытку.";

/**
 * Thin gate in front of {@link OnboardingWizardInner}. The inner component's
 * ~20 `useState(saved?.x ?? default)` initializers only read `saved` on their
 * very first render, so it must never mount before the restored draft is
 * final, otherwise every field locks to its default and the draft is lost
 * for good. restoreOnboardingState requires the SETTLED companies list (see
 * its JSDoc), so when a saved blob exists we wait for `companiesLoading` to
 * clear before computing `saved` and mounting the inner component at all.
 */
export function OnboardingWizard() {
  // Deliberately does not call `useCompany()`. The list it exposes is the
  // shared cache, which is what this gate must not trust - see below.

  // Parsed once (not re-parsed by the cleanup effect below) so the restored
  // value and the "should we wipe the blob" decision always agree.
  const rawBlob = useMemo(() => {
    const raw = onboardingDraftStorage.read();
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null; // malformed: treated as stale below
    }
  }, []);
  // The ownership gate is closed after the initial validation succeeds, or
  // when no validation is needed. A later company-list invalidation is
  // ordinary background work. If it unmounted the inner wizard then, all of
  // its live useState values would be reconstructed from `rawBlob` above —
  // the value from page load, not the draft the customer just typed — and a
  // successful organization submission would appear to do nothing.
  //
  // A failed validation must remain retryable. A later successful fetch needs
  // to remount the wizard with the now-authorized draft, rather than keeping
  // the defaults it showed while ownership was unknown.
  const [initialDraftValidationComplete, setInitialDraftValidationComplete] = useState(
    rawBlob === undefined || rawBlob === null,
  );

  // Whether this account owns the company the draft names is an authorization
  // question, and the answer has to be about the account asking now.
  //
  // The shared company cache could not answer it at all: one entry for every
  // account, served for thirty seconds after a switch with no loading state and
  // no error, so a check that trusted "not loading, no error" handed one
  // account's draft to the next. The entry is keyed by account now, and that
  // trap is gone with it.
  //
  // What survives is smaller and still worth a request. A cached list is the
  // right account's but can be thirty seconds old, so a company created moments
  // ago in another tab is missing from it — and missing reads as "you do not own
  // this", which deletes the draft rather than withholding it. So this still
  // asks for a list fetched for this mount.
  const companiesQuery = useCompanyListQuery({
    staleTime: 0,
    // Only a *parseable* saved draft poses the question. Without one there is
    // nothing to authorize, and this must not add a request to every wizard
    // mount - nor make the cleanup of unreadable junk wait on an endpoint that
    // has no bearing on whether it is junk.
    enabled: rawBlob !== undefined && rawBlob !== null,
  });

  // Decidable only with a list that succeeded, actually arrived, and that the
  // server was willing to give us.
  //
  // Whose list it is stopped being a question here: the entry is keyed by
  // account, so the previous account's list is unreachable rather than merely
  // rejected. What the checks still answer is whether there is an answer at all,
  // and the reason that matters is the *destructive* branch below — an
  // undecidable draft is withheld and recoverable, but a draft judged
  // not-yours is deleted.
  //
  // `isSuccess`: React Query keeps the last good `data` through a failed
  // refetch, and a retained list is not evidence about now.
  //
  // `staleTime: 0` on the query, still: a cached list is the right account's but
  // can be thirty seconds old, and a company created moments ago in another tab
  // would be missing from it — which reads as "this draft belongs to a company
  // you do not own" and deletes it.
  //
  // `unauthorized`: the query folds 401 and 403 into
  // `{ companies: [], unauthorized: true }` rather than throwing, so an auth
  // blip arrives as a *successful* fetch of an empty list and would otherwise
  // read as "this account owns nothing" and delete the draft.
  const ownershipDecidable =
    companiesQuery.isSuccess &&
    companiesQuery.data !== undefined &&
    !companiesQuery.data.unauthorized;

  const { saved, staleStateDetected } = useMemo(() => {
    if (rawBlob === undefined) return { saved: null, staleStateDetected: false };
    // Unreadable, so junk regardless of who owns what. Judged before the
    // ownership check rather than after it, so clearing it does not wait on a
    // company request that cannot change the answer.
    if (rawBlob === null) return { saved: null, staleStateDetected: true };
    // Not decidable yet, or not decidable at all. Either way: restore nothing,
    // delete nothing. A draft withheld is recoverable on the next load; a
    // draft deleted, or one handed to the wrong account, is not.
    if (!ownershipDecidable) return { saved: null, staleStateDetected: false };
    const restored = restoreOnboardingState(rawBlob, companiesQuery.data!.companies);
    return { saved: restored, staleStateDetected: restored === null };
  }, [rawBlob, ownershipDecidable, companiesQuery.data]);

  // A discarded/malformed state should not sit in storage waiting to confuse
  // the next onboarding attempt (e.g. a different signed-in user).
  useEffect(() => {
    if (!staleStateDetected) return;
    onboardingDraftStorage.clear();
  }, [staleStateDetected]);

  // A saved blob exists and its *initial* verification fetch is still in
  // flight: wait, rather than mount the inner wizard with a premature and
  // unrecoverable guess at the draft. Its ~20 `useState(saved?.x ?? default)`
  // initializers only read `saved` once. After that first mount this is a
  // background refetch, which must not tear down the customer's live state.
  //
  // `isFetching`, not `isLoading`. `isLoading` is false whenever the cache
  // holds retained data, so a refetch over a warm cache would mount the wizard
  // while ownership was still undecidable - and with the wizard open, the
  // persist effect would overwrite the customer's own draft with defaults
  // before the answer arrived. `isFetching` covers the refetch too.
  //
  // While in flight, not on failure. The companies query sets `retry: false`,
  // so a failed fetch stays failed; and with no companies the dashboard offers
  // a "Get Started" button wired to onboarding, which a gate that returned null
  // here would make do nothing at all.
  //
  // Mounting does not cost the draft. The persist effect that would overwrite
  // it is itself gated on `effectiveOnboardingOpen`, so a mounted-but-closed
  // wizard writes nothing. If the wizard is open the customer is onboarding
  // right now, which supersedes the draft anyway.
  const waitForInitialDraftValidation =
    !initialDraftValidationComplete && rawBlob !== undefined && companiesQuery.isFetching;

  useEffect(() => {
    if (
      !initialDraftValidationComplete &&
      ownershipDecidable &&
      !companiesQuery.isFetching
    ) {
      setInitialDraftValidationComplete(true);
    }
  }, [initialDraftValidationComplete, ownershipDecidable, companiesQuery.isFetching]);

  if (waitForInitialDraftValidation) {
    return null;
  }

  return <OnboardingWizardInner saved={saved} />;
}

function OnboardingWizardInner({
  saved,
}: {
  saved: Record<string, unknown> | null;
}) {
  const {
    onboardingOpen,
    onboardingOptions,
    closeOnboarding,
    onboardingRouteDismissed: routeDismissed,
    setOnboardingRouteDismissed: setRouteDismissed,
  } = useDialog();
  const { companies, setSelectedCompanyId, loading: companiesLoading } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { companyPrefix: matchedCompanyPrefix } = useParams<{ companyPrefix?: string }>();
  // This component renders beside `<Routes>`, not inside it (`App.tsx`), so it
  // has no route match and `useParams()` gives nothing. Read the prefix from
  // the pathname, which `useLocation()` supplies without a match. The param is
  // kept first so a future move inside the route tree needs no change here.
  const companyPrefix =
    matchedCompanyPrefix ?? companyPrefixFromOnboardingPath(location.pathname);
  // Managed stacks create organizations on Cloud, so the route below never
  // resolves into the create wizard there — see resolveRouteOnboardingOptions.
  const cloudInstance = useCloudInstance();

  // Support opening the wizard from a route (e.g. /onboarding or an existing
  // company's "add agent" entry point) in addition to the dialog context.
  // The company the path names, resolved before the mission lookup below so it
  // has something to ask about. Same match the resolver makes.
  const routeMatchedCompanyId =
    companyPrefix && !companiesLoading
      ? companies.find(
          (company) => company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase(),
        )?.id ?? null
      : null;
  // The mission lookup used to gate this: the step was applied once and not
  // revised, so opening before the answer arrived left the customer on the
  // wrong step. The step no longer depends on the answer, so the wait bought
  // nothing but a slower open. Companies still gate it — the resolver needs
  // them to match the prefix at all.
  const routeOnboardingOptions =
    companyPrefix && companiesLoading
      ? null
      : resolveRouteOnboardingOptions({
          pathname: location.pathname,
          companyPrefix,
          companies,
          cloudManaged: Boolean(cloudInstance),
        });
  const effectiveOnboardingOpen =
    onboardingOpen || (routeOnboardingOptions !== null && !routeDismissed);
  const effectiveOnboardingOptions = onboardingOpen
    ? onboardingOptions
    : routeOnboardingOptions ?? {};

  // Sync disabled adapter types only when the wizard is visible. The wizard is
  // mounted globally, including on /auth, where protected adapter routes are
  // expected to reject signed-out browsers.
  const disabledTypes = useDisabledAdaptersSync({ enabled: effectiveOnboardingOpen });
  const adapterRegistryLoaded = useAdapterRegistryLoaded({ enabled: effectiveOnboardingOpen });

  // A fresh run opens on step 1 — "Name your organization". The Build / Grow
  // front door and its own step 0 are gone: there is one path now, so the
  // wizard drops the customer straight onto the first real question.
  const initialStep = effectiveOnboardingOptions.initialStep ?? 1;
  const existingCompanyId = effectiveOnboardingOptions.companyId;

  const [step, setStep] = useState<Step>((saved?.step as Step) ?? initialStep);
  // The step this run *entered* on, which bounds how far back it can walk.
  // Captured once, when the wizard opens, for the same reason the step itself
  // is: it derives from queries, so a live read would move the floor under a
  // customer mid-flow — and here that would quietly re-open the "create a
  // company" step to a run that already holds one.
  const [entryStep, setEntryStep] = useState<number>((saved?.step as Step) ?? initialStep);
  /**
   * A page that opens straight onto the agent step — a cloud-managed
   * workspace arriving from Cloud's naming screen, or a reload — plays the
   * hand-off's second half on its first frames rather than mounting cold: the
   * first paint holds the naming step's layout (hero room and content closed),
   * the next frame opens them. `arrival` is fixed for the mount; `arrived`
   * flips once. See heroRoomArrival.
   */
  const arrival = entryStep === 3 && beatDelay(1) > 0;
  const [arrived, setArrived] = useState(!arrival);
  useEffect(() => {
    if (arrived) return;
    const frame = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(frame);
  }, [arrived]);
  // The step before this render's, for choosing an entrance that matches
  // where the capsule came from; updated after paint, so during the render
  // in which the step just changed it still names the departed step.
  const lastStep = useRef(step);
  useEffect(() => { lastStep.current = step; }, [step]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  // Step 1
  const [companyName, setCompanyName] = useState((saved?.companyName as string) ?? "");

  // Step 2
  // The name is not defaulted: a pre-filled "Chief of staff" is a choice made
  // on the customer's behalf that they then have to notice and undo. It is the
  // step's only question, and its CTA gates on it.
  const [agentName, setAgentName] = useState((saved?.agentName as string) ?? "");
  const [agentAppearance, setAgentAppearance] = useState(() => agentAppearanceSchema.safeParse(saved?.agentAppearance).data ?? randomAgentAppearance());
  // Defaults to `general` rather than empty. The arc stopped asking for a role
  // — a customer naming their first agent is describing what it does, not
  // filing it — but the hire still needs one, and the guard below returns
  // silently when it is missing. An unset role there would mean Connect
  // appearing to work and hiring nobody.
  const [agentRole, setAgentRole] = useState<AgentRole>(
    // `||`, not `??`: the empty string was this field's default before the arc
    // stopped asking for a role, so every draft saved by an earlier build holds
    // `agentRole: ""`. `??` passes that straight through, and an empty role
    // reaches the silent return in the hire — the exact failure the default
    // exists to prevent, arriving through a restored draft instead of a fresh
    // one.
    (saved?.agentRole as AgentRole) || DEFAULT_AGENT_ROLE,
  );
  const [adapterType] = useState<AdapterType>("pi_local");
  const isLocalApi = adapterType === "pi_local";
  const [localBaseUrl, setLocalBaseUrl] = useState((saved?.localBaseUrl as string) ?? "");
  const [runner, setRunner] = useState<AgentRunnerChoice>("legacy");
  /**
   * Whether a model source has been chosen, as opposed to which one
   * `adapterType` happens to hold.
   *
   * The two are not the same, and reading the second as the first is what made
   * this step arrive with a tile already lit and its input already open: the
   * hire needs an adapter, so `adapterType` always carries one, restored or
   * defaulted. A customer who never touched the row could reach the end of the
   * step having chosen nothing.
   *
   * Always false on arrival, including from a draft that names a source.
   *
   * It used to restore, on the reasoning that someone returning had already
   * answered and asking again threw that answer away. Picking a source is what
   * starts the sign-in now, so a restored selection is not an answer the step
   * can act on — it is a lit tile with nothing behind it, and the sequence has
   * no way to begin from there without either starting a server session
   * unbidden or leaving the button to do a job the row is supposed to do.
   *
   * `adapterType` still restores; it is what the hire needs. This is only about
   * whether the row has been *answered* on this visit.
   */
  const [sourcePicked, setSourcePicked] = useState(false);
  const [setupNameConflict, setSetupNameConflict] = useState<string | null>(null);
  const isCopilot = adapterType === "paperclip_runner";
  const [copilotConnection, setCopilotConnection] = useState<AiConnectionBinding>();
  const savedNativeRunnerDraft = saved?.adapterType === "paperclip_runner" && !(saved?.onboardingCopilot === true && copilotOnboardingQualified);
  const [cwd, setCwd] = useState((saved?.cwd as string) ?? "");
  const [model, setModel] = useState((saved?.model as string) ?? "");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState(
    saved?.adapterType === "paperclip_runner" ? "" : (saved?.url as string) ?? "",
  );
  const [adapterEnvResult, setAdapterEnvResult] =
    useState<AdapterEnvironmentTestResult | null>(null);
  const [adapterEnvError, setAdapterEnvError] = useState<string | null>(null);
  const [adapterEnvLoading, setAdapterEnvLoading] = useState(false);
  const [forceUnsetAnthropicApiKey, setForceUnsetAnthropicApiKey] =
    useState(false);
  const [unsetAnthropicLoading, setUnsetAnthropicLoading] = useState(false);
  const [showMoreAdapters, setShowMoreAdapters] = useState(false);
  /**
   * Whether the connect step is asking for a subscription sign-in or an API key.
   *
   * Restored from the draft like everything else on this step: someone who
   * picked keys, left, and came back should not be handed a sign-in panel they
   * already said no to.
   */
  const [credentialModeChoice, setCredentialMode] = useState<CredentialMode | null>(
    (saved?.credentialModeChoice !== undefined
      ? saved.credentialModeChoice as CredentialMode | null
      : saved?.credentialMode as CredentialMode | undefined) ?? null,
  );
  /**
   * Where the connect step's sign-in sequence is.
   *
   * Picking a source starts it now, rather than a press of the footer button:
   * the row collapses, the card opens, and the button becomes the sign-in. The
   * beats are ordered rather than concurrent, and each waits for the animation
   * before it — see `onboarding-motion`, where the durations these timers use
   * live beside the transitions they mirror.
   *
   * Deliberately not in the draft. A login is a live server session with a
   * deadline on it, and restoring a wizard an hour later into "waiting for a
   * code" would describe a session that is long gone.
   */
  const [connectPhase, setConnectPhase] = useState<ConnectPhase>("idle");
  /**
   * The address the running login wants the customer to open.
   *
   * Reported up by the panel, because the step's own button is what opens it —
   * the card shows the same link inline for anyone finishing in another
   * browser. Its arrival is also what moves the step off its waiting beat.
   */
  const [connectAuthUrl, setConnectAuthUrl] = useState<string | null>(null);
  /**
   * The key itself, held only for as long as the wizard is open. It is written
   * into the adapter config at hire time and never into the draft — a draft is
   * `localStorage`, and a provider key does not belong there.
   */
  const [apiKey, setApiKey] = useState("");
  // The owner's stored Claude subscription login, read right before the hire
  // (see handleGiveHeartbeat). Onboarding applies it with no extra control,
  // so nothing else reads this state yet.
  const [claudeOAuthStatus, setClaudeOAuthStatus] =
    useState<ClaudeOAuthTokenStatusResponse | null>(null);

  // Created entity IDs — pre-populate from existing company when skipping step 1
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(
    existingCompanyId ?? (saved?.createdCompanyId as string) ?? null
  );
  const savedKeys = useSavedProviderKeys(
    createdCompanyId,
    apiKeyEnvKeyFor(adapterType),
    !isLocalApi && effectiveOnboardingOpen && step === 4,
  );
  // The chooser is absent in onboarding. Prefer the user's explicit default;
  // otherwise only reuse an unambiguous account, regardless of list ordering.
  const savedSubscription = savedKeys.subscriptions.find((option) => option.aiConnection?.mode === "responsible_user")
    ?? (savedKeys.subscriptions.length === 1 ? savedKeys.subscriptions[0] : undefined);
  const [selectedSavedKey, setSelectedSavedKey] = useState<{ companyId: string; envKey: string; id: string } | null>(null);
  const selectedApiKeyId = selectedSavedKey?.companyId === createdCompanyId && selectedSavedKey?.envKey === apiKeyEnvKeyFor(adapterType)
    ? selectedSavedKey.id
    : savedKeys.options[0]?.id;
  const selectedApiKey = isLocalApi ? undefined : savedKeys.options.find((option) => option.id === selectedApiKeyId);
  const credentialMode = isCopilot || isLocalApi ? "api" : credentialModeChoice ?? (
    (savedKeys.subscriptions.length > 0 || (adapterType === "claude_local" && savedKeys.storedLogin.data))
      ? "subscription" : savedKeys.options.length || adapterType === "opencode_local" ? "api" : "subscription"
  );
  const [createdCompanyPrefix, setCreatedCompanyPrefix] = useState<
    string | null
  >((saved?.createdCompanyPrefix as string) ?? null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>((saved?.createdAgentId as string) ?? null);
  const [setupAgentId, setSetupAgentId] = useState<string | null>((saved?.setupAgentId as string) ?? null);
  const [setupPrepared, setSetupPrepared] = useState(false);
  const [setupError, setSetupError] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const preparingSetup = useRef(new Set<string>());
  const [restoredSetup, setRestoredSetup] = useState<Agent | null>(null);
  const setupSave = useRef<Promise<unknown>>(Promise.resolve());
  const [createdCompanyGoalId, setCreatedCompanyGoalId] = useState<string | null>(
    (saved?.createdCompanyGoalId as string) ?? null
  );
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(
    (saved?.createdProjectId as string) ?? null
  );
  const [createdIssueRef, setCreatedIssueRef] = useState<string | null>(
    (saved?.createdIssueRef as string) ?? null
  );

  // The company the *route* last supplied, so a navigation that stops naming
  // one can drop it without touching a company the wizard created itself.
  const routeCompanyIdRef = useRef<string | null>(null);
  // The current company, mirrored so the sync effect can read it without
  // taking it as a dependency. Depending on it would re-run the effect on
  // every company change, and the effect also calls setStep - it would drag
  // the user back to the route's initial step mid-flow.
  const createdCompanyIdRef = useRef<string | null>(null);
  // In flight, synchronously. `loading` cannot answer this: it is state, so a
  // second caller in the same tick — key repeat holding Enter down — reads the
  // value the first has not written yet. `createdCompanyId` cannot answer it
  // either, because it is not set until the request it guards has resolved. A
  // ref is written before the request goes out, so the second caller sees it.
  const creatingCompanyRef = useRef(false);
  // Same shape for the hire. Greptile (round-3 PR): with "Test now" gone the
  // Connect handler re-runs a cached failed probe — and two overlapping
  // submissions could then both pass the fresh probe and both hire. `loading`
  // cannot stop the second caller for the same reason as above.
  const hiringAgentRef = useRef<number | null>(null);
  const connectAttemptRef = useRef(0);
  const autoConnectStartedRef = useRef(false);
  // True when the last `adapterEnvResult` came from a config that carried
  // the fixed Claude login binding (see `hireAdapterConfig` in
  // `handleGiveHeartbeat`). A cached result from a config that did not carry
  // the binding cannot answer for a config that now does — see the reuse
  // check in `handleGiveHeartbeat`.
  const adapterEnvResultAppliedStoredLoginRef = useRef(false);
  /**
   * The secret a key typed on this step was stored as, remembered for the key it
   * holds. Connect can be pressed more than once — a hire that fails leaves the
   * customer on the step to try again — and without this each press would store
   * another copy of the same credential.
   */
  const apiKeySecretRef = useRef<{ key: string; companyId: string; envKey: string; binding?: Awaited<ReturnType<typeof storeProviderApiKey>>["binding"]; aiConnection?: AiConnectionBinding } | null>(null);
  const managedSubscriptionRef = useRef<{ companyId: string; binding: AiConnectionBinding } | null>(null);
  const managedProvider = isLocalApi ? undefined : aiProviderForAdapter(isCopilot ? "copilot_runtime" : adapterType);
  const managedSubscriptionProvider = managedProvider === "anthropic" || managedProvider === "openai" || managedProvider === "xai" ? managedProvider : undefined;
  function managedBindingForStep(): AiConnectionBinding | undefined {
    if (isLocalApi) return undefined;
    if (isCopilot) return copilotConnection;
    const restoredBinding = restoredSetup?.companyId === createdCompanyId
      && agentHarnessType(restoredSetup.adapterType, restoredSetup.adapterConfig) === agentHarnessType(adapterType, {})
      ? restoredSetup.runtimeConfig?.aiConnection as AiConnectionBinding | undefined : undefined;
    if (!selectedSavedKey && !apiKey.trim()) {
      if (restoredBinding?.method === (credentialMode === "api" ? "api_key" : "subscription")) return restoredBinding;
      const savedEnv = restoredSetup?.companyId === createdCompanyId
        && agentHarnessType(restoredSetup.adapterType, restoredSetup.adapterConfig) === agentHarnessType(adapterType, {})
        ? restoredSetup.adapterConfig.env as Record<string, unknown> | undefined : undefined;
      if (savedEnv?.[credentialMode === "api" ? apiKeyEnvKeyFor(adapterType) : "CODEX_HOME"]) return undefined;
    }
    if (credentialMode === "api") return selectedApiKey?.aiConnection ?? (
      !selectedApiKey && apiKeySecretRef.current?.companyId === createdCompanyId && apiKeySecretRef.current.envKey === apiKeyEnvKeyFor(adapterType)
        ? apiKeySecretRef.current.aiConnection : undefined);
    return savedSubscription?.aiConnection ?? (managedSubscriptionRef.current?.companyId === createdCompanyId && managedSubscriptionRef.current.binding.provider === managedProvider ? managedSubscriptionRef.current.binding : undefined);
  }
  createdCompanyIdRef.current = createdCompanyId;

  // The step the request wants, mirrored for the same reason. `initialStep` is
  // *derived* - from the company list - so its value changes whenever that
  // query does: a retry, a background refetch, a cache invalidation. An effect that
  // depended on it would re-run on every such change and call setStep, moving
  // a customer who is already mid-flow. Reading it through a ref breaks that
  // dependency, so the effect runs when the wizard *opens* or when the company
  // changes, and takes whatever the step is at that moment.
  const initialStepRef = useRef<Step | undefined>(undefined);
  initialStepRef.current = effectiveOnboardingOptions.initialStep;
  const openingRequestRef = useRef<{ open: boolean; companyId: string | null; hasOpened: boolean } | null>(null);

  /**
   * Forget everything that describes one particular company.
   *
   * Called when the wizard stops holding a company - the route replaced it, or
   * withdrew it. Both are the same event, and clearing only part of it is what
   * lets the next company skip work it has not done: a kept goal id reads as
   * "this company's mission is already written", and the launch path would
   * link the next company's project to the previous company's goal.
   *
   * The name and the prefix are cleared here too and backfilled again from the
   * company list by the effects below, so they always describe the company in
   * hand rather than the one before it.
   */
  function clearCompanyScopedState() {
    setRestoredSetup(null);
    setCopilotConnection(undefined);
    setAgentAppearance(randomAgentAppearance());
    setCreatedCompanyPrefix(null);
    setCompanyName("");
    setCreatedCompanyGoalId(null);
    setCreatedProjectId(null);
    setCreatedIssueRef(null);
    setCreatedAgentId(null);
    setSetupAgentId(null);
    setSetupPrepared(false);
    setSetupError(false);
  }

  // Sync step and company when onboarding opens with explicit options.
  // Only override saved state when explicit options provide values.
  //
  // The step belongs to the request that opened the wizard, not to the latest
  // value of the expression that produced it - see `initialStepRef` above for
  // why those differ. This effect is therefore keyed on the two things that
  // make a *new* request: the wizard opening, and the company changing.
  // Navigating from one company's onboarding path to another re-decides the
  // step; the same request re-deriving a fresher value does not.
  useEffect(() => {
    const routeCompanyId = effectiveOnboardingOptions.companyId ?? null;
    const previousRequest = openingRequestRef.current;
    openingRequestRef.current = { open: effectiveOnboardingOpen, companyId: routeCompanyId,
      hasOpened: previousRequest?.hasOpened === true || effectiveOnboardingOpen };
    if (!effectiveOnboardingOpen) return;
    if (previousRequest?.open && previousRequest.companyId === routeCompanyId) return;
    const initialRequest = previousRequest?.hasOpened !== true;
    const resumesRouteDraft = initialRequest && !onboardingOpen && saved !== null
      && typeof saved.step === "number" && saved.step >= 1 && saved.step <= 5
      && (routeCompanyId ? routeCompanyId === saved.createdCompanyId : !companyPrefix);
    if (initialStepRef.current && !resumesRouteDraft) {
      setStep(initialStepRef.current);
      setEntryStep(initialStepRef.current);
    }
    if (routeCompanyId) {
      // Claim ownership only when the route *introduces* a company. A route
      // that merely names the one already in hand - the wizard created it,
      // then the user navigated to that company's onboarding path - has not
      // supplied anything, so it must not take ownership of it. Otherwise
      // navigating on to `/onboarding` would clear work the wizard did.
      if (routeCompanyId !== createdCompanyIdRef.current
        || (initialRequest && typeof saved?.createdCompanyId === "string"
          && routeCompanyId !== saved.createdCompanyId)) {
        setCreatedCompanyId(routeCompanyId);
        clearCompanyScopedState();
      }
      // Ownership is recorded either way, including when the route merely
      // names the company already in hand. Only the clearing above is
      // conditional.
      //
      // This is a deliberate change to the rule the comment above described.
      // Not recording ownership there protected wizard-created work from a
      // later `/onboarding`, but it also meant that company was never
      // withdrawn: create a company on step 1, visit its own onboarding path,
      // then go to `/onboarding`, and the wizard shows "create a company"
      // while still holding the previous one. The next confirmation then
      // writes that customer's new mission into the old company - which is
      // exactly the failure the withdrawal branch below was written to
      // prevent, reached by a path it could not see.
      //
      // Losing the step-1 progress on `/onboarding` is the better error:
      // `/onboarding` is a request to start a company, so honouring it beats
      // silently writing into a different one.
      routeCompanyIdRef.current = routeCompanyId;
      return;
    }
    if (routeCompanyIdRef.current || (initialRequest && companyPrefix && saved?.createdCompanyId)) {
      // The route named a company and now does not - the user navigated from
      // an existing company's onboarding to `/onboarding`, or to a prefix that
      // matches nothing. Drop it. Keeping it leaves the wizard showing step 1,
      // "create a company", while still holding the previous one, so the next
      // confirmation writes into that company instead of making a new one.
      //
      // Only a company this route supplied is cleared. One the wizard created
      // itself, or restored from saved state, is left alone: the ref is null
      // in those cases, and clearing them would discard real progress.
      //
      // Withdrawing a company clears the same state that replacing one does.
      // The two are the same event - this company is no longer the wizard's -
      // and clearing only half of it leaves ids that make the *next* company
      // skip work it has not done.
      setCreatedCompanyId(null);
      routeCompanyIdRef.current = null;
      clearCompanyScopedState();
    }
  }, [effectiveOnboardingOpen, effectiveOnboardingOptions.companyId]);

  // Backfill issue prefix for an existing company once companies are loaded.
  useEffect(() => {
    if (!effectiveOnboardingOpen || !createdCompanyId || createdCompanyPrefix) return;
    const company = companies.find((c) => c.id === createdCompanyId);
    if (company) setCreatedCompanyPrefix(company.issuePrefix);
  }, [effectiveOnboardingOpen, createdCompanyId, createdCompanyPrefix, companies]);

  // Backfill the name too, for the same company and the same reason.
  //
  // `companyName` is otherwise only ever typed on step 1, so a company that
  // enters the wizard further along has none. That is a dead end rather than a
  // cosmetic gap: the mission step prints the name in its own copy, and both
  // ways forward from that step - the button and the Enter key - require
  // `companyName.trim()`. An existing company opened on the mission step could
  // not leave it. Nothing reached that state until the dashboard started
  // opening agentless companies there.
  useEffect(() => {
    if (!effectiveOnboardingOpen || !createdCompanyId || companyName) return;
    const company = companies.find((c) => c.id === createdCompanyId);
    if (company) setCompanyName(company.name);
  }, [effectiveOnboardingOpen, createdCompanyId, companyName, companies]);

  // Persist wizard state to localStorage on every change
  useEffect(() => {
    if (!effectiveOnboardingOpen) return;
    const state = {
      step, companyName,
      agentName, agentAppearance, agentRole, adapterType, runner, cwd, model, command, args, url, localBaseUrl,
      onboardingCopilot: isCopilot,
      // The mode, never the key: this blob is localStorage.
      credentialMode, credentialModeChoice,
      createdCompanyId, createdCompanyPrefix, createdAgentId, setupAgentId,
      createdCompanyGoalId, createdProjectId, createdIssueRef,
    };
    onboardingDraftStorage.write(JSON.stringify(state));
  }, [
    effectiveOnboardingOpen, step, companyName,
    agentName, agentAppearance, agentRole, adapterType, runner, cwd, model, command, args, url, localBaseUrl,
    credentialMode, credentialModeChoice,
    createdCompanyId, createdCompanyPrefix, createdAgentId, setupAgentId,
    createdCompanyGoalId, createdProjectId, createdIssueRef,
  ]);

  const getCapabilities = useAdapterCapabilities();
  const adapterCaps = getCapabilities(adapterType);

  // Resolve the login environment at render time, so the wizard can decide
  // whether to show the login panel before any adapter test runs. This
  // mirrors the agent configuration form's own resolution, including the
  // managed-sandbox-only redirect (see AgentConfigForm.tsx:618-640). A render
  // must not throw, so a resolver error yields no login environment rather
  // than an error boundary.
  const { data: loginEnvironmentList = [], isSuccess: loginEnvironmentsReady, isFetching: loginEnvironmentsFetching, isError: loginEnvironmentsFailed, refetch: refetchLoginEnvironments } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.environments.list(createdCompanyId)
      : ["environments", "none"],
    queryFn: () => environmentsApi.list(createdCompanyId!),
    enabled: Boolean(createdCompanyId) && effectiveOnboardingOpen && step === 4,
  });
  const { data: instanceSettingsForLogin, isSuccess: loginSettingsReady, isFetching: loginSettingsFetching, isError: loginSettingsFailed, refetch: refetchLoginSettings } = useQuery({
    queryKey: queryKeys.instance.settings,
    queryFn: () => instanceSettingsApi.get(),
    enabled: effectiveOnboardingOpen && step === 4,
  });
  // Wanted across the whole arc, not just the connect step. The progress strip
  // reads it too — see `enteredFromCloud` — and a value fetched only on step 4
  // would let the strip change length as the customer walked through it.
  const { data: experimentalSettingsForLogin, isSuccess: loginPolicyReady, isFetching: loginPolicyFetching, isError: loginPolicyFailed, refetch: refetchLoginPolicy } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    enabled: effectiveOnboardingOpen && step >= 3 && step <= 5,
  });
  const copilotOnboardingEnabled = copilotOnboardingQualified;
  const loginEnvironmentResolution = useMemo(() => {
    try {
      return { environmentId: resolveAdapterTestEnvironmentId({
        agentDefaultEnvironmentId: restoredSetup?.companyId === createdCompanyId ? restoredSetup.defaultEnvironmentId : null,
        instanceDefaultEnvironmentId: instanceSettingsForLogin?.defaultEnvironmentId ?? null,
        localDefaultEnvironmentId: resolveLocalDefaultEnvironmentId(loginEnvironmentList),
        managedSandboxOnly: experimentalSettingsForLogin?.enableManagedSandboxOnly === true,
        managedSandboxEnvironmentId: resolveManagedSandboxEnvironmentId(loginEnvironmentList),
        visibleEnvironmentIds: loginEnvironmentList.map((environment) => environment.id),
      }), error: null };
    } catch (error) {
      return { environmentId: null, error: error instanceof Error ? error.message : "Could not resolve the execution environment." };
    }
  }, [
    restoredSetup, createdCompanyId,
    instanceSettingsForLogin?.defaultEnvironmentId,
    loginEnvironmentList,
    experimentalSettingsForLogin?.enableManagedSandboxOnly,
  ]);
  const resolvedLoginEnvironmentId = loginEnvironmentResolution.environmentId;
  const loginEnvironmentSettingsReady = loginEnvironmentsReady && loginSettingsReady && loginPolicyReady
    && !loginEnvironmentsFetching && !loginSettingsFetching && !loginPolicyFetching;
  const runnerDiscovery = useQuery({
    queryKey: queryKeys.adapters.availability(createdCompanyId, resolvedLoginEnvironmentId),
    queryFn: () => adaptersApi.list({ companyId: createdCompanyId!, environmentId: resolvedLoginEnvironmentId }),
    enabled: Boolean(createdCompanyId) && effectiveOnboardingOpen && step === 4
      && loginEnvironmentSettingsReady,
  });
  const copilotEnvironmentReady = loginEnvironmentsReady && loginSettingsReady && loginPolicyReady && !loginEnvironmentResolution.error;
  const {
    data: adapterModels,
    error: adapterModelsError,
    isLoading: adapterModelsLoading,
    isFetching: adapterModelsFetching,
    refetch: refreshAdapterModels,
  } = useQuery({
    queryKey: isCopilot
      ? ["onboarding-adapter-models", createdCompanyId, adapterType, resolvedLoginEnvironmentId, copilotConnection]
      : createdCompanyId ? queryKeys.agents.adapterModels(createdCompanyId, adapterType, null) : ["agents", "none", "adapter-models", adapterType, null],
    queryFn: () => agentsApi.adapterModels(createdCompanyId!, adapterType, {
      environmentId: isCopilot ? resolvedLoginEnvironmentId : null,
      ...(isCopilot ? { provider: "acpx", acpxAgent: "copilot", aiConnection: copilotConnection } : {}),
    }),
    ...(isCopilot ? COPILOT_MODEL_DISCOVERY_QUERY_OPTIONS : {}),
    enabled: !isLocalApi && Boolean(createdCompanyId) && effectiveOnboardingOpen && step === 4 && (!isCopilot || Boolean(copilotConnection && copilotEnvironmentReady)),
    retry: false,
  });
  const requestCopilotModels = Boolean(isCopilot && createdCompanyId && effectiveOnboardingOpen && step === 4 && copilotConnection && copilotEnvironmentReady);
  const copilotModelScope = JSON.stringify([createdCompanyId, resolvedLoginEnvironmentId, copilotConnection]);
  useEffect(() => {
    if (requestCopilotModels) void refreshAdapterModels();
  }, [requestCopilotModels, copilotModelScope, refreshAdapterModels]);
  const copilotModelReady = Boolean(copilotConnection && copilotEnvironmentReady && !adapterModelsError && !adapterModelsFetching && adapterModels?.some((entry) => entry.id === model.trim()));
  const needsRunnerDiscovery = ["codex_local", "claude_local", "opencode_local", "pi_local"].includes(adapterType) && runner === "auto";
  const resolvedRunner = runner === "auto"
    ? runnerDiscovery.data?.find(item => item.type === adapterType)?.defaultRunner
    : runner;
  const runnerDiscoveryReady = !needsRunnerDiscovery
    || (loginEnvironmentSettingsReady
      && runnerDiscovery.isSuccess && !runnerDiscovery.isFetching && resolvedRunner !== undefined);
  const runnerDiscoveryError = needsRunnerDiscovery && (loginEnvironmentsFailed || loginSettingsFailed || loginPolicyFailed)
    ? "Could not load execution environment settings. Retry setup."
    : needsRunnerDiscovery && runnerDiscovery.isError
      ? "Could not load runner availability. Retry setup."
    : needsRunnerDiscovery && runnerDiscovery.isSuccess && resolvedRunner === undefined
      ? "Runner availability is missing for this harness. Retry setup."
      : null;
  async function retryRunnerAvailability() {
    if (!loginEnvironmentSettingsReady) {
      await Promise.all([refetchLoginEnvironments(), refetchLoginSettings(), refetchLoginPolicy()]);
    } else {
      await runnerDiscovery.refetch();
    }
  }
  const visibleAdapterEnvError = adapterEnvError ?? runnerDiscoveryError;
  const runnerSelectionKey = JSON.stringify([createdCompanyId, resolvedLoginEnvironmentId, adapterType, runner, adapterType === "codex_local" && runner === "auto" ? undefined : resolvedRunner]);
  const runnerSelectionRef = useRef(runnerSelectionKey);
  runnerSelectionRef.current = runnerSelectionKey;
  const resolvedLoginEnvironment = useMemo(
    () =>
      loginEnvironmentList.find((environment) => environment.id === resolvedLoginEnvironmentId) ??
      null,
    [loginEnvironmentList, resolvedLoginEnvironmentId],
  );
  const claudeSetupSelectionKey = JSON.stringify([createdCompanyId, adapterType, runner, resolvedRunner, model, command,
    args, url, credentialMode, apiKey, selectedSavedKey, selectedApiKey?.binding, savedSubscription?.binding,
    resolvedLoginEnvironmentId, resolvedLoginEnvironment?.config]);
  const claudeSetupSelectionRef = useRef(claudeSetupSelectionKey);
  claudeSetupSelectionRef.current = claudeSetupSelectionKey;
  const activeClaudeQualification = useRef<{ attempt: number; selection: string } | null>(null);
  useEffect(() => {
    const active = activeClaudeQualification.current;
    if (!active || active.selection === claudeSetupSelectionKey) return;
    activeClaudeQualification.current = null;
    connectAttemptRef.current++;
    hiringAgentRef.current = null;
    autoConnectStartedRef.current = true;
    setLoading(false);
    setAdapterEnvLoading(false);
    setError("Настройки изменились. Проверьте подключение ещё раз.");
  }, [claudeSetupSelectionKey]);
  const adapterSetupSelectionRef = useRef("");
  const adapterEnvErrorSelectionRef = useRef<string | null>(null);
  adapterSetupSelectionRef.current = adapterType === "codex_local" && runner === "auto" && resolvedLoginEnvironment?.driver === "sandbox"
    ? JSON.stringify([createdCompanyId, adapterType, runner, model, command, args, url, credentialMode, apiKey,
      selectedSavedKey, selectedApiKey?.binding, savedSubscription?.binding, resolvedLoginEnvironmentId, resolvedLoginEnvironment.config]) : "";
  // Sandbox provider capabilities for the login pseudo-terminal gate, loaded
  // only when the adapter declares a login capability — the same query the
  // agent configuration form runs (AgentConfigForm.tsx:652-658).
  const { data: loginEnvironmentCapabilities } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.environments.capabilities(createdCompanyId)
      : ["environment-capabilities", "none"],
    queryFn: () => environmentsApi.capabilities(createdCompanyId!),
    enabled:
      Boolean(createdCompanyId) &&
      adapterCaps.login != null &&
      effectiveOnboardingOpen &&
      step === 4,
  });
  const loginEnvironmentProvider =
    typeof resolvedLoginEnvironment?.config?.provider === "string"
      ? resolvedLoginEnvironment.config.provider
      : null;
  const loginProviderSupportsPty =
    loginEnvironmentProvider != null &&
    loginEnvironmentCapabilities?.sandboxProviders?.[loginEnvironmentProvider]?.supportsLoginPty ===
      true;
  // The same capability gate the agent configuration form uses to show its
  // login panel (AgentConfigForm.tsx:1064), minus the form's fourth input — a
  // full adapter test result. The cheap auth signal below stands in for that
  // input here, so this gate alone only decides whether the login mechanism
  // could ever apply to the current adapter and environment.
  const localLoginHealth = useQuery({ queryKey: queryKeys.health, queryFn: healthApi.get });
  const canUseLocalLogin = Boolean(managedSubscriptionProvider) && resolvedLoginEnvironment?.driver === "local" && (localLoginHealth.data?.localAiLoginSupported ?? localLoginHealth.data?.deploymentMode === "local_trusted");
  const localLogin = useLocalAiLogin(createdCompanyId, {
    provider: managedSubscriptionProvider ?? "anthropic", method: "subscription",
    name: `My ${CONNECT_SOURCE_NAMES[adapterType] ?? managedProvider} subscription`,
    ownership: "personal", agentIds: [], allAgents: true,
  }, sourcePicked && (setupPrepared || Boolean(createdAgentId)) && effectiveOnboardingOpen && step === 4 && canUseLocalLogin && credentialMode !== "api" &&
    Boolean(managedProvider) && !savedSubscription && !savedKeys.storedLogin.data && !managedBindingForStep(),
  );
  useEffect(() => {
    autoConnectStartedRef.current = false;
    hiringAgentRef.current = null;
    if (step === 4) {
      setLoading(false);
      setAdapterEnvLoading(false);
    }
    return () => { connectAttemptRef.current++; };
  }, [effectiveOnboardingOpen, createdCompanyId, adapterType, credentialMode, step]);

  const canShowAdapterLogin = !isLocalApi && Boolean(
    adapterCaps.login != null &&
      resolvedLoginEnvironment?.driver === "sandbox" &&
      resolvedLoginEnvironmentId &&
      createdCompanyId &&
      loginProviderSupportsPty,
  );
  // The cheap signal, re-read whenever the adapter type or the resolved login
  // environment changes (both are part of the query key). It reports whether
  // the host already holds a usable credential, with no adapter environment
  // test. The route reads only host-local state, so a login baked into a
  // sandbox image rather than held on the host reads as `absent` even though
  // the owner could already sign in — the panel then shows for one extra step
  // it did not strictly need, never the reverse.
  const authSignalQuery = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.agents.authSignal(createdCompanyId, adapterType, resolvedLoginEnvironmentId)
      : ["agents", "none", "auth-signal", adapterType, resolvedLoginEnvironmentId],
    queryFn: () =>
      agentsApi.getAdapterAuthSignal(
        createdCompanyId!,
        adapterType,
        resolvedLoginEnvironmentId ?? undefined,
      ),
    enabled:
      Boolean(createdCompanyId) && effectiveOnboardingOpen && step === 4 && canShowAdapterLogin,
  });
  const authSignalStatus = authSignalQuery.data?.status ?? null;
  const showAdapterLoginPanel =
    canShowAdapterLogin && (authSignalStatus === "absent" || authSignalStatus === "unknown");
  /**
   * Restores the connect sequence after a reload.
   *
   * The panel resumes an active session on its own mount, but this step only
   * mounts the panel once the sequence has moved off `idle` — and a reload
   * starts the sequence at `idle` again, deliberately: `connectPhase` is not
   * in the draft. Without this read, a reload during a login would leave the
   * panel unmounted and the resumed session unreachable from this step. A 404
   * means no active session for the caller.
   */
  const activeLoginSessionQuery = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.agents.activeLoginSession(createdCompanyId, adapterType)
      : ["agents", "none", "active-login-session", adapterType],
    queryFn: async () => {
      try {
        return adapterCaps.login?.panelMode === "submitted_browser_code"
          ? await agentsApi.getActiveClaudeSetupTokenLoginSession(createdCompanyId!)
          : await agentsApi.getActiveAdapterAuthLoginSession(createdCompanyId!, adapterType);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled:
      Boolean(createdCompanyId) && effectiveOnboardingOpen && step === 4 && canShowAdapterLogin,
  });
  useEffect(() => {
    if (!activeLoginSessionQuery.data || credentialMode === "api" || savedSubscription || savedKeys.storedLogin.data) return;
    // Re-derive the row's answer along with the sequence: a resumed session
    // implies a source was already picked, and the row stays a question
    // otherwise (see `sourcePicked` above).
    setSourcePicked(true);
    // Skip straight past the collapsing beat — that animation is for a press
    // landing on a step already on screen, not for a reload that should show
    // the running login at once. The panel's own mount reports the resumed
    // prompt through `onPromptReady`, below, which is what moves this beat
    // from `loading` to `ready`, exactly as a fresh press would.
    setConnectPhase((phase) => (phase === "idle" ? "loading" : phase));
  }, [activeLoginSessionQuery.data, credentialMode, savedSubscription, savedKeys.storedLogin.data]);
  /**
   * The signal is being fetched and has not answered yet.
   *
   * Worth its own state rather than folding into "no panel to show". Until it
   * answers, `authSignalStatus` is null and every not-signed-in customer looks
   * momentarily identical to a signed-in one — so the card would assert that
   * they are already signed in, for exactly as long as the request takes, and
   * then replace it with a sign-in prompt. A reassurance that is wrong and then
   * withdrawn is worse than saying nothing for a beat.
   */
  const authSignalUndecided = canShowAdapterLogin && authSignalStatus === null;

  const isLocalAdapterCaps =
    adapterCaps.supportsInstructionsBundle ||
    adapterCaps.supportsSkills ||
    adapterCaps.supportsLocalAgentJwt;
  const isLocalAdapter =
    isLocalAdapterCaps || isCopilot ||
    adapterType === "claude_local" ||
    adapterType === "codex_local" ||
    adapterType === "gemini_local" ||
    adapterType === "kimi_local" ||
    adapterType === "opencode_local" ||
    adapterType === "pi_local" ||
    adapterType === "cursor";
  // Build adapter grids dynamically from the UI registry + display metadata.
  // External/plugin adapters automatically appear with generic defaults, and
  // server-disabled types are filtered out.
  const { recommendedAdapters, moreAdapters } = useMemo(() => {
    const all = listUIAdapters()
      .filter((a) =>
        !ONBOARDING_EXCLUDED_ADAPTER_TYPES.has(a.type) &&
        !disabledTypes.has(a.type) &&
        isVisualAdapterChoice(a.type)
      )
      .map((a) => ({ ...getAdapterDisplay(a.type), type: a.type, ...(a.type === "pi_local" ? { recommended: true, label: "Локальный / корпоративный API" } : {}) }));

    const copilot = copilotOnboardingEnabled && !disabledTypes.has("paperclip_runner") && listUIAdapters().some((a) => a.type === "paperclip_runner")
      ? [{ ...getAdapterDisplay("copilot_runtime"), type: "paperclip_runner", label: "GitHub Copilot", recommended: true }]
      : [];
    return {
      recommendedAdapters: [...all.filter((a) => a.recommended).sort((a, b) => Number(b.type === "pi_local") - Number(a.type === "pi_local")), ...copilot],
      moreAdapters: all.filter((a) => !a.recommended),
    };
  }, [disabledTypes, copilotOnboardingEnabled]);

  /**
   * A source chosen from the visible row. Read off the row rather than off
   * `adapterType` alone, because a restored draft can name an adapter this step
   * no longer offers — a selection the customer cannot see.
   */
  const sourceSelected = adapterRegistryLoaded && !disabledTypes.has("pi_local");

  /**
   * Whether the connect step may advance.
   *
   * One predicate, because there are two ways to advance and they drifted. The
   * button's condition and Cmd+Enter's were written out separately, so when the
   * button gained `sourceSelected` and `adapterEnvLoading` the keyboard kept the
   * older, shorter list — and hired against a source the row had never shown.
   * The same defect the button was just fixed for, one path over.
   *
   * `loading` is deliberately not here. The keyboard handler returns on it
   * before reaching any step, for a reason particular to keystrokes: a second
   * Enter re-enters a handler whose guard is state the first has not written
   * yet. That check belongs at the top of the handler, not per-step.
   *
   * Anything that gates this step belongs in here, so the next one is added
   * once rather than twice.
   */
  const restoredApiCredential = restoredSetup?.companyId === createdCompanyId
    && agentHarnessType(restoredSetup.adapterType, restoredSetup.adapterConfig) === agentHarnessType(adapterType, isCopilot ? { provider: "acpx", acpxAgent: "copilot" } : {})
    && !selectedSavedKey && (restoredSetup.adapterConfig.env as Record<string, unknown> | undefined)?.[apiKeyEnvKeyFor(adapterType)];
  const connectStepReady = Boolean(setupPrepared || createdAgentId) && sourceSelected && !adapterEnvLoading && (isLocalApi || !savedKeys.loading) && runnerDiscoveryReady && (!isCopilot || copilotModelReady);

  useEffect(() => {
    if (step !== 4 || !createdCompanyId || !agentName.trim() || !adapterRegistryLoaded
      || !sourceSelected || createdAgentId || setupPrepared || preparingSetup.current.has(createdCompanyId) || setupError
      || (!sourceSelected && setupNameConflict === JSON.stringify([createdCompanyId, agentName.trim().toLowerCase()]))) return;
    const companyId = createdCompanyId;
    preparingSetup.current.add(companyId);
    const id = setupAgentId ?? crypto.randomUUID();
    let restoring = Boolean(setupAgentId);
    void (async () => {
      if (setupAgentId) {
        try { return await agentsApi.get(setupAgentId, companyId); }
        catch (cause) { if (!(cause instanceof ApiError) || cause.status !== 404) throw cause; }
      }
      if (!setupAgentId) {
        // Only a persisted setup ID identifies an unfinished record for reuse.
        const sameName = (await agentsApi.list(companyId)).filter(agent =>
          agent.status !== "terminated" && agent.pauseReason !== "setup"
          && agent.name.trim().toLowerCase() === agentName.trim().toLowerCase());
        const existing = sourceSelected ? sameName.find(agent => agentHarnessType(agent.adapterType, agent.adapterConfig)
          === agentHarnessType(adapterType, isCopilot ? { provider: "acpx", acpxAgent: "copilot" } : {})) : undefined;
        if (existing) { restoring = true; return existing; }
        // A same-name record may already be complete; choose its provider before adopting it.
        if (!sourceSelected && sameName.length) {
          setSetupNameConflict(JSON.stringify([companyId, agentName.trim().toLowerCase()]));
          return null;
        }
      }
      const provisionalAdapter = disabledTypes.has("process") ? recommendedAdapters[0]?.type : "process";
      if (!sourceSelected && !provisionalAdapter) throw new Error("No agent adapters are available on this instance.");
      const createAdapter = sourceSelected ? adapterType : provisionalAdapter!;
      if (!stillTheSameCompany(companyId)) return null;
      setSetupAgentId(id);
      return agentsApi.create(companyId, {
      setupId: id, name: agentName.trim() || AGENT_ROLE_LABELS[agentRole], appearance: agentAppearance,
      role: agentRole, adapterType: createAdapter, runner,
      adapterConfig: createAdapter === "paperclip_runner" ? { provider: "acpx", acpxAgent: "copilot" } : {},
      metadata: { setupAdapterPending: !sourceSelected },
      onboardingFirstAgent: true, runtimeConfig: buildNewAgentRuntimeConfig({ heartbeatEnabled: false }),
      });
    })().then(agent => {
      if (!agent || !stillTheSameCompany(companyId)) return;
      if (agent.pauseReason === "setup" || agent.status === "pending_approval") {
        setSetupAgentId(agent.id);
        if (!restoring && agent.name) setAgentName(current => current.trim() === agentName.trim() ? agent.name : current);
        if (restoring && agent.adapterConfig) {
          const prior = agent.adapterConfig;
          const localConfig = agent.adapterType === "pi_local" ? prior : {
            ...(prior.cwd ? { cwd: prior.cwd } : {}),
            ...(prior.instructionsFilePath ? { instructionsFilePath: prior.instructionsFilePath } : {}),
            ...(typeof prior.baseUrl === "string" ? { baseUrl: prior.baseUrl,
              env: (prior.env as Record<string, unknown> | undefined)?.OPENAI_API_KEY
                ? { OPENAI_API_KEY: (prior.env as Record<string, unknown>).OPENAI_API_KEY } : {} } : {}),
          };
          setRestoredSetup({ ...agent, adapterType: "pi_local", adapterConfig: localConfig });
          setAgentName(current => current.trim() || agent.name);
          setAgentRole(agent.role);
          setAgentAppearance(resolveAgentAppearance(agent.appearance, agent.id));
          const config = agent.adapterConfig;
          if (agent.metadata?.setupAdapterPending === true) {
            setRunner("legacy");
            setCommand("");
            setArgs("");
            setUrl("");
          } else {
            setModel(current => typeof config.model === "string" && config.model.trim() ? config.model : current);
            setCommand("");
            setArgs("");
            setUrl(typeof config.url === "string" ? config.url : "");
            if (typeof config.baseUrl === "string") setLocalBaseUrl(config.baseUrl);
            setRunner("legacy");
            const binding = agent.runtimeConfig?.aiConnection as AiConnectionBinding | undefined;
            if (binding) setCredentialMode(binding.method === "api_key" ? "api" : "subscription");
            else if ((config.env as Record<string, unknown> | undefined)?.[apiKeyEnvKeyFor(adapterType)]) setCredentialMode("api");
            else if ((config.env as Record<string, unknown> | undefined)?.[CLAUDE_OAUTH_TOKEN_ENV_KEY]
              || (config.env as Record<string, unknown> | undefined)?.CODEX_HOME) setCredentialMode("subscription");
            if (config.provider === "acpx" && config.acpxAgent === "copilot") setCopilotConnection(binding);
          }
        }
      } else setCreatedAgentId(agent.id);
      setSetupPrepared(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    }).catch(cause => {
      if (!stillTheSameCompany(companyId)) return;
      setSetupError(true);
      setError(cause instanceof Error ? cause.message : "Не удалось подготовить агента.");
    }).finally(() => {
      preparingSetup.current.delete(companyId);
      setSetupAttempt(attempt => attempt + 1);
    });
  }, [step, createdCompanyId, agentName, adapterRegistryLoaded, sourceSelected, setupNameConflict, runnerDiscoveryReady, createdAgentId, setupPrepared, setupAttempt]);

  /**
   * Whether this step has a sign-in to do before it can hire.
   *
   * The same four conditions the card itself renders on, named once so the
   * footer button and the card cannot disagree about whether a login is
   * happening. When it is false — an API key, a source already signed in on the
   * sandbox, or a local CLI account — Connect verifies credentials before the hire.
   */
  const connectStepNeedsLogin = Boolean(
    credentialMode !== "api" &&
      // Connection-list invalidation can arrive before the login's completion
      // poll. Keep its controller mounted until it reports success; otherwise
      // the saved account replaces the panel and "Connecting" never finishes.
      (connectAuthUrl || (
        showAdapterLoginPanel &&
        !savedSubscription &&
        !(adapterType === "claude_local" && savedKeys.storedLogin.data)
      )) &&
      !savedKeys.loading &&
      createdCompanyId &&
      resolvedLoginEnvironmentId,
  );

  /**
   * Whether the source's login ends by taking a code back from the customer.
   *
   * This is what splits the two waits, and it is a real difference rather than
   * a cosmetic one. The browser-code login finishes here, in the field on the
   * card, so the button is busy and says so. The displayed-code login finishes
   * somewhere else entirely — another tab, possibly another device — so the
   * button is not busy, it is waiting, and a spinner would be claiming work
   * this screen is not doing.
   */
  const loginSubmitsBrowserCode =
    adapterCaps.login?.panelMode === "submitted_browser_code";

  /** Without browser login, show instructions for the selected execution environment. */
  const connectStepHasNoSandbox =
    credentialMode !== "api" && !canShowAdapterLogin && !authSignalUndecided;

  /*
    The sequence's derived state. Space and visibility are separate throughout:
    the credential link fades on the first beat but keeps its space until the
    second, and the card takes its space on the second but only appears on the
    third — so the column slides once, when there is a reason for it to.
  */
  const connectCollapsed =
    connectPhase !== "idle" && connectPhase !== "unwindRow" && sourceSelected;
  const connectProgress = sourceSelected && !setupPrepared && !createdAgentId && !setupError ? "Creating your agent…" : adapterEnvLoading ? "Testing connection…" : loading ? "Connecting…" : null;
  const hasSavedSubscription = Boolean(savedSubscription || savedKeys.storedLogin.data ||
    (credentialMode !== "api" && managedBindingForStep()));
  const connectHasCard = credentialMode === "api" || connectStepNeedsLogin || connectStepHasNoSandbox || Boolean(connectProgress);
  const connectCardLive =
    connectHasCard &&
    (connectPhase === "loading" ||
    connectPhase === "ready" ||
      connectPhase === "waiting" ||
      connectPhase === "connecting");
  const connectCardSpace = connectCardLive || (connectHasCard && connectPhase === "unwindCard");
  /**
   * Whether the card's contents are rendered at all.
   *
   * A beat longer than its space, and that beat matters. The height animates
   * away over `unwindRoom`, and an element with nothing in it has no height to
   * animate *from* — unmounting the contents when the space starts closing
   * collapsed the column in a single frame instead, a 54px jump measured right
   * after the fade. They stay until the room has finished closing.
   *
   * It cannot simply be "always", either: the panel starts a server session on
   * mount, so rendering it at idle would open an OAuth session merely because
   * the step was visited.
   */
  const connectCardMounted = connectCardSpace || connectPhase === "unwindRoom";
  const connectLinkSpace =
    connectPhase === "idle" ||
    connectPhase === "collapsing" ||
    connectPhase === "unwindRoom" ||
    connectPhase === "unwindRow";
  const connectLinkVisible = !isLocalApi && (connectPhase === "idle" || connectPhase === "unwindRow");

  /**
   * When "Connecting" started, and whether the login behind it has finished.
   *
   * Two facts because they now arrive at different times. The button says
   * "Connecting" the moment a code is pasted, but the credential only exists
   * once the server confirms it, a poll and a completion read later. The hire
   * waits for both: the stored login, and two seconds of "Connecting" counted
   * from the paste — so a fast server still shows the state, and a slow one
   * does not have the hold added on top of its own wait.
   */
  const connectingSinceRef = useRef<number | null>(null);
  const [connectCredentialStored, setConnectCredentialStored] = useState(false);
  /** What the button was offering before a paste, for when the paste is refused. */
  const phaseBeforeSubmitRef = useRef<ConnectPhase>("waiting");

  /** A sign-in is running and has not succeeded. */
  const connectStepLoggingIn =
    connectStepNeedsLogin && connectPhase !== "idle" && connectPhase !== "connecting";

  // Detecting a credential is enough to start verification once the user has
  // chosen Claude or Codex. A saved-list refresh during that work is not a new
  // attempt, and a failed attempt waits for an explicit Connect retry.
  useEffect(() => {
    if (!effectiveOnboardingOpen || step !== 4 || connectPhase !== "ready" ||
        !connectStepReady || connectStepNeedsLogin || connectCredentialStored ||
        credentialMode !== "subscription" ||
        (adapterType !== "claude_local" && adapterType !== "codex_local") ||
        (!hasSavedSubscription && localLogin.status !== "ready") ||
        loading || autoConnectStartedRef.current) return;
    autoConnectStartedRef.current = true;
    void handleGiveHeartbeat();
  }, [effectiveOnboardingOpen, step, connectPhase, connectStepReady, connectStepNeedsLogin,
    connectCredentialStored, credentialMode, adapterType, hasSavedSubscription, localLogin.status, loading]);

  /**
   * The beats, each waiting for the animation before it.
   *
   * `loading` is the exception: it ends when the server produces a prompt, not
   * on a timer, so the card waits exactly as long as the login actually takes.
   */
  useEffect(() => {
    if (step !== 4) return;
    if (connectPhase === "collapsing") {
      const t = setTimeout(
        // A key has nothing to fetch — the field exists the moment the source
        // is chosen — and a source already signed in has nothing to fetch
        // either. Only a live sign-in spends a beat waiting for its prompt;
        // sending the others through it would stall them on a card that never
        // opens.
        () =>
          setConnectPhase(
            credentialMode === "api" || !connectStepNeedsLogin ? "ready" : "loading",
          ),
        beatDelay(SOURCE_COLLAPSE_MS),
      );
      return () => clearTimeout(t);
    }
    if (connectPhase === "connecting") {
      // Not before the login is stored. "Connecting" starts at the paste now,
      // ahead of the server confirming anything, so a hire from here would go
      // out against a source with no credential to run on.
      if (!connectCredentialStored || !runnerDiscoveryReady) return;
      // No success state: the step advances. The hold is so "Connecting" is
      // legible as a state rather than a flicker on the way out — a step that
      // left the instant a paste landed would read as the paste having gone
      // wrong. Counted from when "Connecting" appeared, so the time the server
      // spent confirming counts toward it instead of being added to it.
      //
      // A beat rather than a bare timer because Back stays live through it. A
      // dropped handle hired two seconds after the customer had backed out,
      // landing them on Review having asked for the opposite; `handleGiveHeartbeat`
      // has no notion of the phase and could not refuse it. Leaving the phase —
      // Back, the step changing, unmount — now cancels the hire with it.
      const shownFor =
        connectingSinceRef.current === null ? 0 : Date.now() - connectingSinceRef.current;
      const t = setTimeout(
        () => void handleGiveHeartbeat(),
        Math.max(0, CONNECTED_HOLD_MS - shownFor),
      );
      return () => clearTimeout(t);
    }
    if (connectPhase === "unwindCard") {
      const t = setTimeout(() => setConnectPhase("unwindRoom"), beatDelay(CARD_EXIT_MS));
      return () => clearTimeout(t);
    }
    if (connectPhase === "unwindRoom") {
      const t = setTimeout(() => setConnectPhase("unwindRow"), beatDelay(MAKE_ROOM_MS));
      return () => clearTimeout(t);
    }
    if (connectPhase === "unwindRow") {
      // Let the selection go as the row starts back, not once it has arrived.
      // Held to the end, the tile changed colour with nothing else moving —
      // a cut rather than a release. Released here it fades across the travel
      // and settles into its default instead of snapping to it. The tiles take
      // the slower duration while `settling`, so the fade lasts the journey.
      setSourcePicked(false);
      const t = setTimeout(() => setConnectPhase("idle"), beatDelay(SOURCE_COLLAPSE_MS));
      return () => clearTimeout(t);
    }
    return;
  }, [step, connectPhase, credentialMode, connectStepNeedsLogin, connectCredentialStored, runnerDiscoveryReady]);

  /**
   * The button's four faces, and which of them can be pressed.
   *
   * It is only live where there is something for it to do: a sign-in to open, a
   * key to submit, or a hire to run. Through the waits it is the step reporting
   * rather than offering — see `FooterNav`, where the label cross-fades over an
   * easing width so those changes read as one control rather than four.
   */
  const connectSourceLabel = isCopilot ? "GitHub Copilot" : CONNECT_SOURCE_NAMES[adapterType] ?? adapterType;
  const connectCta: { label: string; icon: FooterPrimaryIcon; disabled: boolean } =
    setupError ? { label: isLocalApi ? "Повторить" : "Retry", icon: "arrow", disabled: false } :
    isLocalApi ? { label: loading || adapterEnvLoading ? "Проверка подключения…" : "Подключить", icon: loading || adapterEnvLoading ? "spinner" : "arrow", disabled: !connectStepReady || loading || !localBaseUrl.trim() || !model.trim() } : connectProgress
      ? { label: adapterEnvLoading ? "Testing…" : connectProgress, icon: "spinner", disabled: true }
      : connectPhase === "waiting"
      ? { label: "Waiting for code", icon: "spinner", disabled: true }
      : connectPhase === "connecting"
        ? { label: "Connecting", icon: "spinner", disabled: true }
        : connectPhase === "ready"
          ? connectStepNeedsLogin
            ? {
                label: `Sign in to ${connectSourceLabel}`,
                icon: "none",
                disabled: !connectAuthUrl,
              }
            : {
                label: "Connect",
                icon: "arrow",
                disabled:
                  !connectStepReady || (!isCopilot && credentialMode === "api" && !apiKey.trim() && !selectedApiKey && !restoredApiCredential && !managedBindingForStep()),
              }
          : // Nothing is chosen on arrival, and the row is what chooses. Until
            // it has been answered the button has nothing to do.
            { label: "Далее", icon: "arrow", disabled: true };

  /**
   * Back, on the connect step, unwinds the sign-in before it leaves the step.
   *
   * This hides the card; it does not cancel the login. Unmounting the panel
   * does not release the server session — the session stays reachable for a
   * later resume, the same read that restores it after a reload — so backing
   * out and returning shows the sign-in still running, not a fresh one.
   *
   * Nothing releases it explicitly any more. The card carried a Cancel that
   * did, sitting beside an instruction and directly above this step's own
   * Back, and two ways out of one screen is one too many — the button went and
   * the release went with it. What is left is the server deadline, which is
   * the same thing that collects a session abandoned by closing the tab.
   */
  function unwindConnectStep() {
    connectAttemptRef.current++;
    hiringAgentRef.current = null;
    setLoading(false);
    setAdapterEnvLoading(false);
    setConnectAuthUrl(null);
    connectingSinceRef.current = null;
    setConnectCredentialStored(false);
    // Where the reverse starts depends on how far the sequence got. Backing out
    // during the collapse has no card to close and no room to give back.
    // With no card open, the row is the whole of the unwind.
    setConnectPhase(connectCardLive ? "unwindCard" : "unwindRow");
  }

  /**
   * What the step's primary action does, for both the button and Cmd+Enter.
   *
   * One function rather than the condition written twice. The keyboard path
   * has drifted from the button here before — the comment on its `step === 4`
   * branch is about exactly that — and the gap it left was a hire that skipped
   * a check. This one would be worse: Cmd+Enter would hire before the sign-in
   * it is meant to start, against a source with no credential.
   */
  function handleConnectStepPrimary() {
    if (setupError) { setSetupError(false); setSetupAttempt(value => value + 1); setError(null); return; }
    // Mid-sequence the button belongs to the sign-in, not to the step.
    if (connectPhase === "ready" && connectStepNeedsLogin) {
      if (connectAuthUrl) window.open(connectAuthUrl, "_blank", "noreferrer,noopener");
      setConnectPhase("waiting");
      return;
    }
    // The hold owns the hire once "Connecting" is showing. That now starts at
    // the paste, before the credential exists, so Cmd+Enter here would hire
    // against a source with nothing to run on.
    if (connectPhase === "connecting") return;
    if (connectStepLoggingIn) return;
    void handleGiveHeartbeat();
  }

  /**
   * When the input canvas is open: exactly when a source has been chosen.
   *
   * The card is the answer to the tile that was just pressed, so an untouched
   * row leaves nothing under it — a sign-in bar offered before the question was
   * answered says the step already knows which provider is meant, which it does
   * not.
   *
   * This used to open for a pending sign-in as well, `|| showAdapterLoginPanel`,
   * so that a restored draft naming an adapter this step no longer offers still
   * had something to press. That reasoning came from when the row arrived with a
   * selection already made and an invisible one was a dead end. It is not one
   * now: the row is a question, an unofferable saved adapter simply leaves it
   * unanswered, and the visible tiles are the thing to press. `showAdapterLoginPanel`
   * still decides what goes *inside* the canvas — only not whether it exists.
   */

  /**
   * Open once there is something in it: a key field, a sign-in that has been
   * started, or the news that no sign-in is possible.
   *
   * It no longer opens on selection alone. The card is the sign-in itself now,
   * and a sign-in starts when Connect is pressed — so between picking a tile
   * and pressing the button there is nothing to put here, and the step is the
   * question and the button, which is what the design draws.
   */
  const canvasOpen =
    sourceSelected &&
    (credentialMode === "api" || connectCardSpace || connectStepHasNoSandbox);

  const COMMAND_PLACEHOLDERS: Record<string, string> = {
    claude_local: "claude",
    codex_local: "codex",
    gemini_local: "gemini",
    kimi_local: "kimi",
    pi_local: "pi",
    cursor: "agent",
    opencode_local: "opencode",
  };
  const effectiveAdapterCommand =
    command.trim() ||
    (COMMAND_PLACEHOLDERS[adapterType] ?? adapterType.replace(/_local$/, ""));

  // Throw the cached probe away whenever the thing it probed changes. Every
  // input to `buildAdapterConfig` belongs in this list, `credentialMode` and
  // `apiKey` included: the Connect handler reuses a passing result instead of
  // re-probing, so a dependency missing here is a hire that skips the check.
  //
  // That is reachable rather than theoretical. The hire runs after the probe
  // inside one try/catch, so a hire that fails — a network error, a server
  // error — leaves the pass sitting in state. Switch to an API key, paste one,
  // press Connect again, and without these two the wizard would hire against a
  // key nothing ever tested.
  useEffect(() => {
    if (step !== 4) return;
    setAdapterEnvResult(null);
    adapterEnvResultAppliedStoredLoginRef.current = false;
    if (adapterEnvErrorSelectionRef.current !== adapterSetupSelectionRef.current) setAdapterEnvError(null);
  }, [step, adapterType, runner, model, command, args, url, localBaseUrl, credentialMode, apiKey, selectedSavedKey, selectedApiKey?.id, savedSubscription?.id, createdCompanyId, copilotConnection, resolvedLoginEnvironmentId, runner === "auto" ? runnerDiscovery.data?.find(item => item.type === adapterType)?.defaultRunner : undefined]);

  /**
   * Leaving the step puts the row back to a question.
   *
   * Deliberately keyed on the step and nothing else. It used to reset on
   * `adapterType` too, which made picking a source take two clicks: the first
   * set the phase *and* the adapter, this effect saw the adapter change and put
   * the phase straight back to idle, and only a second click — which changed no
   * adapter, so woke no effect — was allowed to stand.
   *
   * Nothing else needs to reset it. A source can only change by being picked,
   * and picking sets the phase itself; the credential mode can only change
   * before the sequence starts, because its control is inert once the row has
   * collapsed. Switching either no longer needs its own reset: the panel keeps
   * its server session reachable for a later resume instead of releasing it on
   * the remount, so there is nothing left here for that change to undo.
   */
  useEffect(() => {
    if (step === 4) return;
    setConnectPhase("idle");
    setConnectAuthUrl(null);
    setSourcePicked(false);
    connectingSinceRef.current = null;
    setConnectCredentialStored(false);
  }, [step]);

  const selectedModel = (adapterModels ?? []).find((m) => m.id === model);
  const hasAnthropicApiKeyOverrideCheck =
    adapterEnvResult?.checks.some(
      (check) =>
        check.code === "claude_anthropic_api_key_overrides_subscription"
    ) ?? false;
  const shouldSuggestUnsetAnthropicApiKey =
    adapterType === "claude_local" &&
    adapterEnvResult?.status === "fail" &&
    hasAnthropicApiKeyOverrideCheck;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return (adapterModels ?? []).filter((entry) => {
      if (!query) return true;
      const provider = extractProviderIdWithFallback(entry.id, "");
      return (
        entry.id.toLowerCase().includes(query) ||
        entry.label.toLowerCase().includes(query) ||
        provider.toLowerCase().includes(query)
      );
    });
  }, [adapterModels, modelSearch]);
  const groupedModels = useMemo(() => {
    if (adapterType !== "opencode_local") {
      return [
        {
          provider: "models",
          entries: [...filteredModels].sort((a, b) => a.id.localeCompare(b.id))
        }
      ];
    }
    const groups = new Map<string, Array<{ id: string; label: string }>>();
    for (const entry of filteredModels) {
      const provider = extractProviderIdWithFallback(entry.id);
      const bucket = groups.get(provider) ?? [];
      bucket.push(entry);
      groups.set(provider, bucket);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, entries]) => ({
        provider,
        entries: [...entries].sort((a, b) => a.id.localeCompare(b.id))
      }));
  }, [filteredModels, adapterType]);

  function reset() {
    onboardingDraftStorage.clear();
    // Back to the first step — "Name your organization". There is no front
    // door before it anymore, so a fresh run opens here.
    setStep(1);
    setLoading(false);
    setError(null);
    setCompanyName("");
    // Back to the mount defaults: an empty name (the step's only question, and
    // what its CTA gates on) and the neutral role every onboarding hire uses.
    setAgentName("");
    setAgentAppearance(randomAgentAppearance());
    setAgentRole(DEFAULT_AGENT_ROLE);
    setRunner("legacy");
    setLocalBaseUrl("");
    setModel("");
    setCommand("");
    setArgs("");
    setUrl("");
    setAdapterEnvResult(null);
    adapterEnvResultAppliedStoredLoginRef.current = false;
    setAdapterEnvError(null);
    setAdapterEnvLoading(false);
    setForceUnsetAnthropicApiKey(false);
    setUnsetAnthropicLoading(false);
    setClaudeOAuthStatus(null);
    setCopilotConnection(undefined);
    setCreatedCompanyId(null);
    setCreatedCompanyPrefix(null);
    setCreatedAgentId(null);
    setSetupAgentId(null);
    setSetupPrepared(false);
    setSetupError(false);
    setCreatedCompanyGoalId(null);
    setCreatedProjectId(null);
    setCreatedIssueRef(null);
  }

  function handleClose() {
    reset();
    closeOnboarding();
    // On the /onboarding route the wizard is also kept open by the route
    // itself, so closing the dialog must mark the route dismissed — otherwise
    // effectiveOnboardingOpen stays true and the wizard re-renders instead of
    // handing off to the launcher card (PAP-52).
    setRouteDismissed(true);
  }

  /**
   * Whether the company an async handler started for is still the one in hand.
   *
   * A route change can switch companies while a request is in flight, and the
   * switch clears the created resource ids so the new company starts clean. A
   * write that lands afterwards would put them back, and hand that company the
   * previous one's goal, project, issue or agent — which is exactly what the
   * clearing exists to prevent.
   *
   * Every async write below asks this before it attributes anything. It never
   * cancels the server work, which is done and correct either way; it declines
   * only to record it against a company it does not belong to.
   */
  function stillTheSameCompany(companyIdAtStart: string | null) {
    return createdCompanyIdRef.current === companyIdAtStart;
  }

  /**
   * Whether a just-created company can still be committed to this wizard.
   *
   * Company-list refreshes can make the surrounding app adopt the POST result
   * before the continuation runs. That is the same successful transition, not
   * a takeover. A different id still means navigation moved the wizard to a
   * different organization while the request was in flight.
   */
  function canCommitCreatedCompany(
    companyIdAtStart: string | null,
    returnedCompanyId: string,
  ) {
    const companyIdNow = createdCompanyIdRef.current;
    if (companyIdNow === companyIdAtStart || companyIdNow === returnedCompanyId) {
      return true;
    }
    setError("Организация создана, но настройка уже открыта для другой организации.");
    return false;
  }

  async function handleLaunchToDashboard() {
    if (!createdCompanyId || !createdAgentId) {
      setError(INCOMPLETE_ONBOARDING_STATE_MESSAGE);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let goalId = createdCompanyGoalId;
      if (!goalId) {
        const goals = await goalsApi.list(createdCompanyId);
        goalId = selectDefaultCompanyGoalId(goals);
        if (stillTheSameCompany(createdCompanyId)) setCreatedCompanyGoalId(goalId);
      }

      let projectId = createdProjectId;
      if (!projectId) {
        const projects = await projectsApi.list(createdCompanyId);
        const existingOnboardingProject = selectReusableOnboardingProject(projects);
        if (existingOnboardingProject) {
          projectId = existingOnboardingProject.id;
        } else {
          const project = await projectsApi.create(
            createdCompanyId,
            buildOnboardingProjectPayload(goalId)
          );
          projectId = project.id;
          queryClient.invalidateQueries({
            queryKey: queryKeys.projects.list(createdCompanyId)
          });
        }
        if (stillTheSameCompany(createdCompanyId)) setCreatedProjectId(projectId);
      }

      let issueRef = createdIssueRef;
      if (!issueRef) {
        const issue = await issuesApi.create(
          createdCompanyId,
          buildOnboardingIssuePayload({
            title: DEFAULT_TASK_TITLE,
            assigneeAgentId: createdAgentId,
            projectId,
            goalId
          })
        );
        issueRef = issue.identifier ?? issue.id;
        if (stillTheSameCompany(createdCompanyId)) setCreatedIssueRef(issueRef);
        queryClient.invalidateQueries({
          queryKey: queryKeys.issues.list(createdCompanyId)
        });
      }

      // Everything above is server work and stands on its own: the company has
      // its goal, its onboarding project and its first task. What follows is
      // this wizard finishing — selecting a company, discarding its own state
      // and navigating. None of that is right for a customer who has moved to
      // another company in the meantime: it would take them back, and `reset()`
      // would discard the progress they had started there.
      if (!stillTheSameCompany(createdCompanyId)) return;

      const prefix = createdCompanyPrefix;
      // Select the new company as a route sync, not a manual switch: the
      // explicit navigate below is the intended destination, so page-memory's
      // "restore last page" (which falls back to /dashboard) must not fire and
      // clobber the first-task URL. See PAP-404.
      setSelectedCompanyId(createdCompanyId, { source: "route_sync" });
      reset();
      closeOnboarding();
      // Drop the user straight into the first task's detail page (not the
      // dashboard) so they land on the conversation the agent will start in.
      navigate(prefix ? `/${prefix}/issues/${issueRef}` : `/issues/${issueRef}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить первую задачу");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Store the typed key as the customer's own user secret, and report whether it
   * is in place.
   *
   * A user secret rather than a company one, to match the subscription half of
   * this very step: signing in stores the Claude token as a user secret and
   * binds a `user_secret_ref`. Two credential modes on one step that scoped
   * their secrets differently would be hard to justify and easy to get wrong
   * later. It also keeps the key to the person who typed it instead of exposing
   * it to everyone with company secret access, and agent runs still resolve it
   * through the company's responsible user.
   *
   * A user secret needs a definition to hang off. The Claude token's is fixed
   * and server-owned; there is no such definition for API keys, so onboarding
   * creates a distinct definition for each new key, preserving existing keys. That needs company owner or admin rights, which
   * whoever just created this company in onboarding has.
   *
   * Returns false on failure, having set the error. Callers must treat false as
   * a stop: there is deliberately no path that hands the raw key back, because
   * the only thing left to do with it would be to embed it.
   */
  async function storeApiKeyUserSecret(companyId: string): Promise<boolean> {
    const key = apiKey.trim();
    const envKey = apiKeyEnvKeyFor(adapterType);
    if (apiKeySecretRef.current?.key === key && apiKeySecretRef.current.companyId === companyId && apiKeySecretRef.current.envKey === envKey) return true;
    try {
      if (managedProvider) {
        await aiConnectionsApi.create(companyId, { provider: managedProvider, method: "api_key", name: `My ${CONNECT_SOURCE_NAMES[adapterType] ?? managedProvider} API`, ownership: "personal", apiKey: key, agentIds: [], allAgents: true });
        apiKeySecretRef.current = { key, companyId, envKey, aiConnection: { provider: managedProvider, method: "api_key", mode: "responsible_user" } };
        return true;
      }
      const stored = await storeProviderApiKey(companyId, envKey, key);
      apiKeySecretRef.current = { key, companyId, envKey, binding: stored.binding };
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? `Не удалось сохранить ключ API: ${err.message}`
          : "Не удалось сохранить ключ API.",
      );
      return false;
    }
  }

  function buildAdapterConfig(bindApiKey = false, setupRunner?: AgentRunner): Record<string, unknown> {
    const adapter = getUIAdapter(adapterType);
    const savedConfig = restoredSetup?.companyId === createdCompanyId
      && agentHarnessType(restoredSetup.adapterType, restoredSetup.adapterConfig) === agentHarnessType(adapterType, isCopilot ? { provider: "acpx", acpxAgent: "copilot" } : {})
      ? restoredSetup.adapterConfig : {};
    const builtConfig = adapter.buildAdapterConfig({
      ...defaultCreateValues,
      adapterType,
      runner,
      ...(isCopilot ? { adapterSchemaValues: { provider: "acpx", acpxAgent: "copilot" } } : adapterType === "pi_local" ? { adapterSchemaValues: { ...savedConfig, baseUrl: localBaseUrl.trim() } } : {}),
      resolvedRunner: setupRunner ?? resolvedRunner,
      model:
        adapterType === "gemini_local"
          ? model || DEFAULT_GEMINI_LOCAL_MODEL
          : adapterType === "kimi_local"
            ? model || DEFAULT_KIMI_LOCAL_MODEL
          : adapterType === "cursor"
            ? model || DEFAULT_CURSOR_LOCAL_MODEL
            : adapterType === "opencode_local"
              ? model || DEFAULT_OPENCODE_LOCAL_MODEL
              : model,
      command,
      args,
      url,
      dangerouslySkipPermissions:
        adapterType === "claude_local" || adapterType === "opencode_local",
      dangerouslyBypassSandbox:
        adapterType === "codex_local"
          ? runner === "legacy" && DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX
          : defaultCreateValues.dangerouslyBypassSandbox
    });
    const savedEnv = { ...((savedConfig.env as Record<string, unknown>) ?? {}) };
    if (isLocalApi && savedConfig.baseUrl !== localBaseUrl.trim()) delete savedEnv.OPENAI_API_KEY;
    if (adapterType === "claude_local") {
      if (credentialMode === "api" || managedBindingForStep()) delete savedEnv[CLAUDE_OAUTH_TOKEN_ENV_KEY];
      if (credentialMode === "subscription" || managedBindingForStep()) {
        delete savedEnv.ANTHROPIC_API_KEY;
        delete savedEnv.ANTHROPIC_AUTH_TOKEN;
      }
    }
    const config: Record<string, unknown> = { ...savedConfig, ...builtConfig,
      ...((savedConfig.env || builtConfig.env) ? { env: { ...savedEnv, ...((builtConfig.env as object) ?? {}) } } : {}) };
    if (isLocalApi) {
      Object.assign(config, { baseUrl: localBaseUrl.trim(), model: `local/${model.trim().replace(/^local\//, "")}` });
      delete config.command;
      delete config.args;
    }
    if (adapterType === "claude_local" && forceUnsetAnthropicApiKey) {
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
    }
    // A key typed on this step is the credential the agent is being hired with,
    // so it has to reach the configuration the hire sends — and the same one the
    // environment test probes, or the test would pass on a config the hire does
    // not use. Only when the mode asks for it: leaving a stale reference in the
    // config after switching back to a subscription is what the server rejects
    // alongside the Claude OAuth binding.
    //
    // A reference, never the key itself. The adapter configuration is
    // persisted and revisioned, so a `{ type: "plain", value }` here would leave
    // a live credential at rest in every copy of it. This mirrors
    // `buildFixedClaudeOAuthBinding`, which holds a reference to the stored
    // Claude token for the same reason.
    //
    // Guarded on the caller having stored the secret, not on the key being
    // present. If storing failed this stays false, and the right outcome is a
    // configuration with no credential — which the hire then blocks on — rather
    // than one that quietly falls back to embedding the value.
    if (!managedBindingForStep() && credentialMode === "api" && (bindApiKey || selectedApiKey)
      && (!((savedConfig.env as Record<string, unknown> | undefined)?.[apiKeyEnvKeyFor(adapterType)])
        || selectedSavedKey || apiKey.trim())) {
      const env =
        typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env[apiKeyEnvKeyFor(adapterType)] = selectedApiKey?.binding ?? apiKeySecretRef.current?.binding;
      config.env = env;
    }
    if (credentialMode === "subscription" && savedSubscription?.binding && !(savedConfig.env as Record<string, unknown> | undefined)?.CODEX_HOME) {
      config.env = { ...((config.env as object) ?? {}), CODEX_HOME: savedSubscription.binding };
    }
    return config;
  }

  function buildSetupRuntimeConfig(heartbeatEnabled: boolean) {
    const { aiConnection: _savedBinding, ...runtimeConfig } = restoredSetup?.companyId === createdCompanyId ? restoredSetup.runtimeConfig : {};
    const binding = managedBindingForStep();
    return { ...runtimeConfig, ...buildNewAgentRuntimeConfig({ heartbeatEnabled }), ...(binding ? { aiConnection: binding } : {}) };
  }

  const setupDetailsReady = runnerDiscoveryReady && (!isCopilot || copilotModelReady);
  const setupSnapshot = step === 4 && setupPrepared && setupAgentId && !createdAgentId && !loading
    ? JSON.stringify({ name: agentName.trim() || AGENT_ROLE_LABELS[agentRole], appearance: agentAppearance,
      ...(sourceSelected && (setupDetailsReady || isCopilot) ? {
        adapterType, runner,
        adapterConfig: setupDetailsReady ? buildAdapterConfig(Boolean(apiKeySecretRef.current?.binding)) : { provider: "acpx", acpxAgent: "copilot" },
        ...(setupDetailsReady ? { defaultEnvironmentId: resolvedLoginEnvironmentId, runtimeConfig: buildSetupRuntimeConfig(false) } : {}),
        metadata: { ...restoredSetup?.metadata, setupAdapterPending: false },
      } : {}),
    })
    : null;
  useEffect(() => {
    if (!setupSnapshot || !setupAgentId || !createdCompanyId) return;
    const companyId = createdCompanyId;
    const id = setupAgentId;
    setupSave.current = setupSave.current.catch(() => {}).then(async () => {
      if (!stillTheSameCompany(companyId) || hiringAgentRef.current !== null) return;
      await agentsApi.update(id, JSON.parse(setupSnapshot), companyId);
    });
    void setupSave.current.catch(cause => {
      if (stillTheSameCompany(companyId)) setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки агента.");
    });
  }, [setupSnapshot, setupAgentId, createdCompanyId]);

  async function runAdapterEnvironmentTest(
    adapterConfigOverride?: Record<string, unknown>,
    appliedStoredClaudeLoginBinding = false,
    isCurrent = () => true,
    onQualifiedConfig?: (config: Record<string, unknown>, adapters: AdapterInfo[], environmentId: string | null) => void,
  ): Promise<AdapterEnvironmentTestResult | null> {
    if (!runnerDiscoveryReady) return null;
    if (!createdCompanyId) {
      setAdapterEnvError(
        "Создайте или выберите организацию перед проверкой подключения."
      );
      return null;
    }
    const selection = adapterSetupSelectionRef.current;
    const testIsCurrent = () => isCurrent() && adapterSetupSelectionRef.current === selection;
    adapterEnvErrorSelectionRef.current = null;
    setAdapterEnvLoading(true);
    setAdapterEnvError(null);
    try {
      let environmentList: Environment[];
      let settings: InstanceSettings;
      let managedSandboxOnly: boolean;
      try {
        const [list, generalSettings, experimentalSettings] = await Promise.all([
          queryClient.ensureQueryData({
            queryKey: queryKeys.environments.list(createdCompanyId),
            queryFn: () => environmentsApi.list(createdCompanyId),
          }),
          queryClient.ensureQueryData({
            queryKey: queryKeys.instance.settings,
            queryFn: () => instanceSettingsApi.get(),
          }),
          queryClient.ensureQueryData({
            queryKey: queryKeys.instance.experimentalSettings,
            queryFn: () => instanceSettingsApi.getExperimental(),
          }),
        ]);
        environmentList = list;
        settings = generalSettings;
        managedSandboxOnly = experimentalSettings?.enableManagedSandboxOnly === true;
      } catch {
        if (!testIsCurrent()) return null;
        setAdapterEnvError(
          "Could not load environment settings to determine which environment to test in. Retry the test.",
        );
        return null;
      }
      // Mirror the server run-time resolution, including the managed-sandbox-only
      // redirect: when the resolution lands on the local environment and the
      // policy is on, probe the managed sandbox the real run uses instead. The
      // resolver throws when no managed sandbox is available, which the outer
      // catch surfaces as a fail-closed error rather than a local host probe.
      const environmentId = resolveAdapterTestEnvironmentId({
        agentDefaultEnvironmentId: restoredSetup?.companyId === createdCompanyId ? restoredSetup.defaultEnvironmentId : null,
        instanceDefaultEnvironmentId: settings?.defaultEnvironmentId ?? null,
        localDefaultEnvironmentId: resolveLocalDefaultEnvironmentId(environmentList),
        managedSandboxOnly,
        managedSandboxEnvironmentId: resolveManagedSandboxEnvironmentId(environmentList),
        // The policy hides the local environment, so an instance default that
        // still points at the hidden local row names no visible environment.
        // Pass the visible ids so the resolver redirects that stale local
        // default to the managed sandbox instead of sending the hidden local id.
        visibleEnvironmentIds: environmentList.map((environment) => environment.id),
      });
      if (!testIsCurrent()) return null;
      const selectedEnvironment = environmentList.find(environment => environment.id === environmentId);
      const selectedConfig = selectedEnvironment?.config;
      if (!createdAgentId && adapterType === "codex_local" && runner === "auto"
        && selectedEnvironment?.driver === "sandbox" && typeof selectedConfig?.image === "string"
        && /^[^\s@]+@sha256:[a-f0-9]{64}$/.test(selectedConfig.image)
        && !selectedConfig.snapshot && !selectedConfig.template && !selectedConfig.templateRef) {
        const availabilityKey = queryKeys.adapters.availability(createdCompanyId, environmentId);
        const adapters = await queryClient.fetchQuery({ queryKey: availabilityKey, staleTime: 0,
          queryFn: () => adaptersApi.list({ companyId: createdCompanyId, environmentId }) });
        if (!testIsCurrent()) return null;
        const codex = adapters.find(adapter => adapter.type === "codex_local");
        const native = adapters.find(adapter => adapter.type === "paperclip_runner");
        if (!codex || (codex.defaultRunner !== "paperclip" && codex.defaultRunner !== "legacy")
          || !codex.supportedRunners?.includes(codex.defaultRunner)) {
          throw new Error("Could not confirm Codex runner availability for this environment. Retry setup.");
        }
        if (codex.defaultRunner !== "paperclip" && !codex?.disabled && !codex?.overriddenBuiltin
          && !native?.disabled && !native?.overriddenBuiltin) {
          const probe = await environmentsApi.probe(environmentId!, createdCompanyId);
          if (!testIsCurrent()) return null;
          if (probe.ok !== true || probe.details?.platformQualificationRecorded !== true
            || typeof probe.details.leaseId !== "string" || !probe.details.leaseId) {
            throw new Error(typeof probe.details?.platformQualificationDiagnostic === "string"
              ? probe.details.platformQualificationDiagnostic
              : probe.summary || "The environment's platform qualification could not be confirmed. Retry the connection probe or select Legacy runner in Advanced.");
          }
          const refreshed = await queryClient.fetchQuery({ queryKey: availabilityKey, staleTime: 0,
            queryFn: () => adaptersApi.list({ companyId: createdCompanyId, environmentId }) });
          if (!testIsCurrent()) return null;
          const refreshedCodex = refreshed.find(adapter => adapter.type === "codex_local");
          const defaultRunner = refreshedCodex?.defaultRunner;
          if ((defaultRunner !== "paperclip" && defaultRunner !== "legacy")
            || !refreshedCodex?.supportedRunners?.includes(defaultRunner)) {
            throw new Error("Could not confirm the environment's default runner. Retry setup.");
          }
        }
      }
      if (!testIsCurrent()) return null;
      const selection = { adapterType, runner, savedAgentId: createdAgentId,
        environment: environmentList.find(environment => environment.id === environmentId) };
      const qualified = await qualifyClaudeSetup({ ...selection,
        readAdapters: () => adaptersApi.list({ companyId: createdCompanyId, environmentId }),
        probeEnvironment: () => environmentsApi.probe(environmentId!, createdCompanyId),
        isCurrent: testIsCurrent,
      });
      if (!testIsCurrent() || (needsClaudeSetupQualification(selection) && !qualified)) return null;
      let testedConfig = adapterConfigOverride ?? buildAdapterConfig();
      if (qualified) {
        testedConfig = buildAdapterConfig(true, qualified.runner);
        if (appliedStoredClaudeLoginBinding) testedConfig.env = {
          ...(isEnvRecord(testedConfig.env) ? testedConfig.env : {}), ...buildFixedClaudeOAuthBinding(),
        };
        onQualifiedConfig?.(testedConfig, qualified.adapters, environmentId);
      }
      const result = await agentsApi.testEnvironment(
        createdCompanyId,
        adapterType,
        {
          adapterConfig: testedConfig,
          ...(restoredSetup?.companyId === createdCompanyId ? { agentId: restoredSetup.id } : {}),
          ...(["codex_local", "claude_local", "opencode_local", "pi_local"].includes(adapterType) && runner !== "auto" ? { runner } : {}),
          ...(managedBindingForStep() ? { aiConnection: managedBindingForStep() } : {}),
          environmentId,
        }
      );
      if (!testIsCurrent()) return null;
      setAdapterEnvResult(result);
      adapterEnvResultAppliedStoredLoginRef.current = appliedStoredClaudeLoginBinding;
      return result;
    } catch (err) {
      if (!testIsCurrent()) return null;
      adapterEnvErrorSelectionRef.current = selection || null;
      setAdapterEnvError(
        err instanceof Error ? err.message : "Не удалось проверить подключение к модели"
      );
      return null;
    } finally {
      if (isCurrent()) setAdapterEnvLoading(false);
    }
  }

  // Step 1 → 3 ("Name your organization"): create the organization, then go
  // straight to the first agent. There is no mission step between them anymore.
  //
  // No goal is written here: the mission is collected later, in the chat with
  // the first agent, so writing an empty one now would only give the
  // organization a goal it did not choose.
  async function handleCreateCompany() {
    if (createdCompanyId) {
      setStep(3);
      return;
    }
    if (creatingCompanyRef.current) return;
    creatingCompanyRef.current = true;
    setLoading(true);
    setError(null);
    const companyIdAtStart = createdCompanyIdRef.current;
    try {
      const company = await companiesApi.create({ name: companyName.trim() });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      // Nothing was in hand when this started, so "unchanged" means still
      // nothing. A route that supplied a company while the request was open has
      // taken over the wizard, and adopting the company just created would
      // fight it — and would leave the customer on a company they never
      // navigated to.
      if (!canCommitCreatedCompany(companyIdAtStart, company.id)) return;
      setCreatedCompanyId(company.id);
      // Keep the mirror current rather than waiting for the next render:
      // anything downstream that asks `stillTheSameCompany` in this tick would
      // otherwise be told no.
      createdCompanyIdRef.current = company.id;
      setCreatedCompanyPrefix(company.issuePrefix);
      setSelectedCompanyId(company.id);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать организацию");
    } finally {
      creatingCompanyRef.current = false;
      setLoading(false);
    }
  }


  // Step 4 → 5 ("Give it a heartbeat"): hire the lead agent + seed its
  // instructions, then advance to Review. Guarded so revisiting step 4
  // doesn't hire a second agent.
  async function handleGiveHeartbeat() {
    if (!createdCompanyId) return;
    if (!setupPrepared && !createdAgentId) return;
    if (isCopilot && (!copilotOnboardingEnabled || !sourceSelected || !copilotModelReady)) {
      setError("Connect GitHub Copilot and select an available model before creating this agent.");
      return;
    }
    if (createdAgentId) {
      setStep(5);
      return;
    }
    if (!runnerDiscoveryReady || hiringAgentRef.current !== null) return;
    const attempt = ++connectAttemptRef.current;
    const guardClaudeSetup = adapterType === "claude_local" && runner === "auto";
    const setupSelection = claudeSetupSelectionRef.current;
    activeClaudeQualification.current = guardClaudeSetup ? { attempt, selection: setupSelection } : null;
    const isCurrent = () => connectAttemptRef.current === attempt && stillTheSameCompany(createdCompanyId)
      && runnerSelectionRef.current === runnerSelectionKey
      && (!guardClaudeSetup || claudeSetupSelectionRef.current === setupSelection);
    hiringAgentRef.current = attempt;
    autoConnectStartedRef.current = true;
    setLoading(true);
    setError(null);
    let qualifiedDiscovery: { adapters: AdapterInfo[]; environmentId: string | null } | undefined;
    try {
      if (isLocalApi) {
        try {
          const endpoint = new URL(localBaseUrl.trim());
          if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
        } catch { throw new Error("Укажите URL API с http:// или https://, без логина, параметров и фрагмента."); }
        if (!model.trim().replace(/^local\//, "")) throw new Error("Укажите идентификатор модели.");
      }
      if (adapterType === "opencode_local") {
        const selectedModelId = model.trim();
        if (!isValidOpenCodeModelId(selectedModelId)) {
          setError(
            "OpenCode requires an explicit model in provider/model format."
          );
          return;
        }
        if (adapterModelsError) {
          setError(
            adapterModelsError instanceof Error
              ? adapterModelsError.message
              : "Failed to load OpenCode models."
          );
          return;
        }
        if (adapterModelsLoading || adapterModelsFetching) {
          setError(
            "OpenCode models are still loading. Please wait and try again."
          );
          return;
        }
        const discoveredModels = adapterModels ?? [];
        if (!discoveredModels.some((entry) => entry.id === selectedModelId)) {
          setError(
            discoveredModels.length === 0
              ? "No OpenCode models discovered. Run `opencode models` and authenticate providers."
              : `Configured OpenCode model is unavailable: ${selectedModelId}`
          );
          return;
        }
      }

      // Onboarding applies a stored Claude subscription login automatically,
      // with no extra control. A new user who signs in, leaves, and returns
      // should not sign in a second time — that is the board's direction.
      // The binding is a reference to the owner's stored value, never the
      // value itself (see buildFixedClaudeOAuthBinding). The server rejects
      // that binding together with a configured ANTHROPIC_API_KEY, so this
      // checks the built configuration first and asks the status route only
      // when there is no such conflict.
      //
      // Read the stored-login status before the environment test below, and
      // fold it into one adapter configuration. The test must probe the same
      // configuration the hire sends — a config without the binding can
      // report missing authentication for a user the binding would have
      // covered.
      // Store the key before anything is built from it, so both the probe and the
      // hire describe it the same way — as a reference. A failure here stops the
      // hire rather than falling through to a configuration with no credential.
      let apiKeyStored = false;
      if (!isCopilot && credentialMode === "api" && !selectedApiKey && apiKey.trim()) {
        apiKeyStored = await storeApiKeyUserSecret(createdCompanyId);
        if (!apiKeyStored || !isCurrent()) return;
      }
      if (credentialMode !== "api" && canUseLocalLogin && managedProvider && !managedBindingForStep() && !savedSubscription && !savedKeys.storedLogin.data) {
        await localLogin.connect();
        if (!isCurrent()) return;
        managedSubscriptionRef.current = { companyId: createdCompanyId, binding: { provider: managedProvider, method: "subscription", mode: "responsible_user" } };
      }
      const managedBinding = managedBindingForStep();
      const baseAdapterConfig = buildAdapterConfig(apiKeyStored);
      let storedClaudeLogin: ClaudeOAuthTokenStatusResponse | null = null;
      if (
        !managedBinding && adapterType === "claude_local" &&
        !adapterConfigHasAnthropicApiKey(baseAdapterConfig)
      ) {
        try {
          storedClaudeLogin = await agentsApi.getClaudeOAuthTokenStatus(createdCompanyId);
        } catch (err) {
          // A fixed 404 means the owner has no stored value. It is not a
          // failure.
          if (!(err instanceof ApiError) || err.status !== 404) throw err;
          storedClaudeLogin = null;
        }
        if (!isCurrent()) return;
        setClaudeOAuthStatus(storedClaudeLogin);
      }
      const shouldApplyStoredClaudeLogin = storedClaudeLogin !== null;
      let hireAdapterConfig = shouldApplyStoredClaudeLogin
        ? {
            ...baseAdapterConfig,
            env: {
              ...(isEnvRecord(baseAdapterConfig.env) ? baseAdapterConfig.env : {}),
              ...buildFixedClaudeOAuthBinding(),
            },
          }
        : baseAdapterConfig;

      if (isLocalAdapter) {
        // A cached result is reusable only when it tested the same
        // configuration the hire below sends, and only when it does not
        // block the hire — see blocksAgentCreate. With the "Test now" card
        // gone, this button is the only way to re-probe. Reusing a stale
        // blocking result, or a result from a config that did not carry the
        // stored login, would lock out a customer who has since fixed the
        // problem or signed in.
        const cachedUsable =
          !needsClaudeSetupQualification({ adapterType, runner, savedAgentId: createdAgentId, environment: resolvedLoginEnvironment }) && adapterEnvResult &&
          adapterEnvResultAppliedStoredLoginRef.current === shouldApplyStoredClaudeLogin &&
          !blocksAgentCreate(adapterEnvResult)
            ? adapterEnvResult
            : null;
        const result =
          cachedUsable ??
          (await runAdapterEnvironmentTest(hireAdapterConfig, shouldApplyStoredClaudeLogin, isCurrent,
            (config, adapters, environmentId) => { hireAdapterConfig = config; qualifiedDiscovery = { adapters, environmentId }; }));
        if (!result || !isCurrent()) return;
        // Block the hire on a failed environment test. Also block it on a
        // pass or a warn result that reports missing authentication — the
        // agent cannot run without one of those.
        if (blocksAgentCreate(result)) {
          const nativeCodexError = adapterType === "codex_local" && result.adapterType === "paperclip_runner"
            ? result.checks.find(check => check.level === "error")?.message : undefined;
          setError(
            nativeCodexError || (result.status === "fail"
              ? "Проверка подключения не прошла. Исправьте параметры и повторите попытку."
              : "Сервер отклонил авторизацию. Проверьте ключ API."),
          );
          return;
        }
      }

      // `agentRole` always holds a value now (see its default), so this is a
      // type narrowing rather than a gate — but it stays, because a future
      // path that clears the role must not reach a hire that silently no-ops.
      if (!agentRole || !isCurrent()) return;

      const hireName = agentName.trim() || AGENT_ROLE_LABELS[agentRole];

      // The company may already hold this agent. A wizard that reopens on the
      // agent step after the hire — the dashboard's agentless offer on a stale
      // list, a restored run — has no `createdAgentId` to stop it, and the
      // server accepts a repeat name by numbering it, so the customer who
      // walks the step twice ends up with "Ada" and "Ada 2". An agent with the
      // same name on the same source is that agent: adopt it and move on to
      // Review, the way a run that remembers its hire does.
      const existingAgents = setupAgentId ? null : await agentsApi.list(createdCompanyId).catch(() => null);
      if (!isCurrent()) return;
      const existing = existingAgents?.find(
        (agent) =>
          agent.id !== setupAgentId &&
          agent.name.trim().toLowerCase() === hireName.toLowerCase() &&
          agentHarnessType(agent.adapterType, agent.adapterConfig) === agentHarnessType(adapterType, hireAdapterConfig),
      );
      if (existing) {
        if (!isCurrent()) return;
        setCreatedAgentId(existing.id);
        setAgentAppearance(resolveAgentAppearance(existing.appearance, existing.id));
        queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(createdCompanyId)
        });
        setStep(5);
        return;
      }

      // Invalidation prevents sending a hire for an abandoned verification.
      // Once submitted, this existing API has no rollback contract; navigation
      // can only suppress its completion, just as it does for a manual hire.
      await setupSave.current.catch(() => {});
      if (!isCurrent()) return;
      const hire = await agentsApi.hire(createdCompanyId, {
        ...(setupAgentId ? { setupAgentId } : {}),
        // The name is optional; an agent that reaches here without one is
        // named for the job it was hired to do rather than left blank.
        name: hireName,
        appearance: agentAppearance,
        role: agentRole,
        ...(restoredSetup?.companyId === createdCompanyId ? { reportsTo: restoredSetup.reportsTo } : {}),
        adapterType,
        adapterConfig: hireAdapterConfig,
        ...(["codex_local", "claude_local", "opencode_local", "pi_local"].includes(adapterType) && runner !== "auto" ? { runner } : {}),
        ...(shouldApplyStoredClaudeLogin ? { applyStoredClaudeLogin: true } : {}),
        // The server owns what the first agent is told now: this marker seeds
        // the chief-of-staff persona over the agent's entry instruction file.
        // The wizard no longer composes or overwrites it.
        onboardingFirstAgent: true,
        ...(restoredSetup?.companyId === createdCompanyId && restoredSetup.defaultEnvironmentId ? { defaultEnvironmentId: resolvedLoginEnvironmentId } : {}),
        runtimeConfig: buildSetupRuntimeConfig(true)
      });
      if (!isCurrent()) return;
      if (hire.approval) {
        await approvalsApi.approve(
          hire.approval.id,
          "Согласовано при настройке первого агента."
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.approvals.list(createdCompanyId)
        });
      }
      const agent = hire.agent;
      queryClient.invalidateQueries({
        queryKey: queryKeys.agents.list(createdCompanyId)
      });
      // The agent's instruction file is seeded server-side from the
      // `onboardingFirstAgent` marker above (the chief-of-staff persona). The
      // wizard no longer composes or overwrites it.

      if (!isCurrent()) return;
      setCreatedAgentId(agent.id);
      // Advance to the Review step — the lead is now online. The user drives
      // strategy + hiring from the planning chat after "Get started".
      setStep(5);
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : "Не удалось создать агента");
    } finally {
      if (hiringAgentRef.current === attempt) hiringAgentRef.current = null;
      if (activeClaudeQualification.current?.attempt === attempt) activeClaudeQualification.current = null;
      if (isCurrent()) {
        if (qualifiedDiscovery) queryClient.setQueryData(
          queryKeys.adapters.availability(createdCompanyId, qualifiedDiscovery.environmentId), qualifiedDiscovery.adapters,
        );
        setLoading(false);
      }
      // Authentication is already saved. A failed probe or hire must offer a
      // retry with that account, rather than keep the completed login busy.
      if (connectCredentialStored && isCurrent()) {
        connectingSinceRef.current = null;
        setConnectAuthUrl(null);
        setConnectPhase((phase) => phase === "connecting" ? "ready" : phase);
      }
    }
  }

  async function handleUnsetAnthropicApiKey() {
    if (!createdCompanyId || unsetAnthropicLoading) return;
    setUnsetAnthropicLoading(true);
    setError(null);
    setAdapterEnvError(null);
    setForceUnsetAnthropicApiKey(true);

    const configWithUnset = (() => {
      const config = buildAdapterConfig();
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
      return config;
    })();

    try {
      if (createdAgentId) {
        await agentsApi.update(
          createdAgentId,
          { adapterConfig: configWithUnset },
          createdCompanyId
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(createdCompanyId)
        });
      }

      const result = await runAdapterEnvironmentTest(configWithUnset);
      if (result?.status === "fail") {
        setError(
          "Retried with ANTHROPIC_API_KEY unset in adapter config, but the environment test is still failing."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to unset ANTHROPIC_API_KEY and retry."
      );
    } finally {
      setUnsetAnthropicLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Something nearer the key already dealt with it. The company-name field
    // handles Enter itself and does not check for a modifier, so Cmd+Enter in
    // that field reaches both handlers — and both would start creating a
    // company. The `loading` guard below cannot catch that: `setLoading(true)`
    // has not landed while the same event is still bubbling, so the second
    // caller reads the value the first one has not written yet. Two companies,
    // one keystroke.
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      // Every button below is disabled while a request is in flight. The
      // keyboard has to honour the same rule, or a second Enter re-enters a
      // handler whose guard is a piece of state the first one has not set
      // yet — two organizations for one name, two agents for one hire.
      if (loading) return;
      if (step === 1 && companyName.trim()) void handleCreateCompany();
      else if (step === 3 && agentName.trim()) setStep(4);
      // `connectStepReady`, the same predicate the step's button uses. Spelling
      // the condition out here again is what let this path hire against a
      // source the tile row had never shown, after the button was gated and
      // this was not.
      // Also gated on `connectStepLoggingIn`, the way the button is: a sign-in
      // that is already running has nothing for this to do, and re-entering it
      // would start a second server session.
      else if (
        step === 4 &&
        agentName.trim() &&
        connectStepReady &&
        !connectStepLoggingIn
      )
        handleConnectStepPrimary();
      else if (step === 5) handleLaunchToDashboard();
    }
  }

  if (!effectiveOnboardingOpen) return null;

  // The arc strip stands in for the full-length bar only when the run began on
  // the arc — the Cloud-first path, where the company already exists and step 1
  // never happens. A run that started at step 1 keeps one continuous count.

  // Back lands on whatever came before this step *for this run*, which is not
  // always `step - 1`. The run goes 1 → 3 (there is no mission step 2 between
  // naming the organization and naming the agent), so the agent step walks
  // back to step 1 rather than to a screen the customer never saw.
  function backStepFrom(current: Step): Step {
    if (current === 3) return 1;
    return (current - 1) as Step;
  }

  const isAgentArcStep = agentArcStepFor(step) !== null;
  /**
   * True when the organization was named in Cloud rather than here.
   *
   * `enableManagedSandboxOnly` is the cloud-tenant shape — the connect step
   * already resolves its login environment through it. A tenant wearing it did
   * not ask for the organization's name, because Cloud did, so the walk the
   * customer is on is four steps and this is the second.
   *
   * A self-hosted run that enters at the agent step is a different case with
   * the same `entryStep`: an existing company that has no agents yet. There was
   * no naming screen before it, so its walk really is three, and it keeps the
   * shorter strip.
   */
  const enteredFromCloud = experimentalSettingsForLogin?.enableManagedSandboxOnly === true;
  const showsAgentArcStepper = isAgentArcStep && entryStep >= 3 && !enteredFromCloud;

  const launchStateIncomplete = step === 5 && (!createdCompanyId || !createdAgentId);
  /**
   * Whether the step hand-off plays out. Under reduced motion — and where the
   * platform cannot be asked, which `beatDelay` reads the same way — the next
   * step's content simply takes the departing one's place: a sequence that
   * holds the screen for a departure nobody sees is just a slower screen.
   */
  const stepHandoff = beatDelay(1) > 0;
  const heroRoomTarget = step === 1 || !arrived ? heroRoomMotion.closed : arrival && lastStep.current === entryStep ? heroRoomArrival : heroRoomMotion.open;
  const capsuleTarget = step === 1 || !arrived ? capsuleRoomExit : step === 3 && stepHandoff && lastStep.current === 1 ? capsuleRoomEnter : capsuleHeroMotion.animate;
  const visibleError = error ?? (launchStateIncomplete ? INCOMPLETE_ONBOARDING_STATE_MESSAGE : null);
  const displayError = visibleError && /[а-яё]/i.test(visibleError) ? visibleError
    : visibleError ? "Не удалось завершить настройку. Проверьте доступность сервера и повторите попытку." : null;

  return (
    <Dialog
      open={effectiveOnboardingOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DialogPortal>
        {/* Plain div instead of DialogOverlay — Radix's overlay wraps in
            RemoveScroll which blocks wheel events on our custom (non-DialogContent)
            scroll container. A plain div preserves the background without scroll-locking. */}
        <div className="fixed inset-0 z-50 bg-background" />
        {/* A deliberate hook for "the wizard mounted".

            The tests that assert it opens used to prove it by finding any text
            in the document — which, with the front door mocked to null in that
            suite, was only ever the close button's screen-reader label. Removing
            the button took the proof with it, and those tests would have gone on
            passing indefinitely if it had stayed. A named anchor says what they
            mean rather than depending on whatever happens to render. */}
        <div
          data-testid="onboarding-wizard"
          className="fixed inset-0 z-50 flex"
          onKeyDown={handleKeyDown}
        >
          {/* Form column — the wizard opens directly on step 1, so there is no
              front-door choice ahead of it, and it fills the width on every
              step (the mission step's half-width split is gone). */}
          <div className="w-full flex flex-col overflow-y-auto">
            <div
              className={cn(
                // my-auto, not items-center on the column: they look identical
                // until a step is taller than the window, where centring by
                // alignment overflows in both directions and the top cannot be
                // scrolled to. Auto margins collapse to zero with no free space.
                "mx-auto my-auto shrink-0",
                // No card. The steps sit on the page ground rather than in a
                // bordered, filled frame — the frame was drawing a box around
                // content that is already the only thing on screen, and its
                // edge competed with the tiles' own strokes. The two branches
                // now differ only in measure. One element styled two ways, not
                // two wrappers, so the step content below renders exactly once.
                // Step 1 takes the arc's measure too. Its footer is now the
                // same pair, and a pair styled identically but sitting 96px
                // narrower than the next screen's makes the whole frame jump on
                // Continue — which is the thing that read as "off" to begin
                // with, and is more obvious once the buttons match.
                // 40px sides, so the column inside the 560px frame is 480px:
                // the measure the connect sequence is drawn to. The arc shares
                // one shell, so the other steps take that measure rather than
                // sitting narrower than the step between them.
                //
                // It has been both ways, and the objection that moved it last
                // time has not been retested since it moved back. A 64px inset
                // (a 432px column) was chosen because at the wider measure the
                // two model tiles stretch and the name field sits under a
                // question far narrower than itself. The connect step is now
                // drawn to 480px, so the shell followed it. If step 1 or step 3
                // reads loose, that is the reason and this is the line — but
                // narrowing the shell again would put the connect step back out
                // of step with its own design, so the fix would belong in those
                // steps' own content rather than here.
                isAgentArcStep || step === 1
                  ? "w-(--sz-560px) max-w-full px-8 py-10 sm:px-10 sm:py-11"
                  : "w-full max-w-md px-8 py-12",
              )}
            >
              {/* Full-length progress bar (brand .wsteps/.wstep) — segment N
                  filled once step ≥ N. Completed segments jump back.
                  Hidden for a run that entered on the agent arc: the arc strip
                  below counts that run's three steps, and showing both put two
                  progress bars on the same screen. A run that started at step 1
                  keeps this one throughout, so its count never restarts.

                  Step 2 is absent: onboarding no longer asks for the mission, so
                  a segment for it would be one the run can never fill, and the
                  count would visibly skip from 1 to 3. */}
              {!showsAgentArcStepper && (
                <Stepper
                  step={onboardingStepPositionFor(step)}
                  total={ONBOARDING_WIZARD_STEPS.length}
                  labels={ONBOARDING_STEP_LABELS}
                  canJumpToStep={(target) =>
                    canJumpToOnboardingStep({
                      targetStep: ONBOARDING_WIZARD_STEPS[target - 1]!,
                      currentStep: step,
                      entryStep,
                    })
                  }
                  onJumpToStep={(target) =>
                    setStep(ONBOARDING_WIZARD_STEPS[target - 1]! as Step)
                  }
                />
              )}

              {/* The agent arc's progress strip. Numbered 1–3 over the wizard's
                  steps 3–5, because company creation already happened in Cloud
                  and the mission step is skipped when it did. */}
              {showsAgentArcStepper && (
                <Stepper
                  step={agentArcStepFor(step)!}
                  canJumpToStep={(target) =>
                    canJumpToOnboardingStep({
                      targetStep: AGENT_ARC_WIZARD_STEPS[target - 1]!,
                      currentStep: step,
                      entryStep,
                    })
                  }
                  onJumpToStep={(target) => setStep(AGENT_ARC_WIZARD_STEPS[target - 1]! as Step)}
                />
              )}

              {/* The hero, above the heading: one character held in the same tree
                  slot across steps 3–5, so React reuses the DOM node and moving
                  between steps never replays the entrance. It is dormant while
                  the agent is being specified and wakes on Review. */}
              {(step === 1 || (step >= 3 && step <= 5)) && (
                // reducedMotion="user" defers to the OS setting, so the hero
                // arrives in place for anyone who asked for less movement. The
                // token layer zeroes the CSS durations; this covers the JS half.
                <MotionConfig reducedMotion="user">
                  {/* mb-6 continues the prototype's single rhythm past this
                      block: it groups the hero and heading, and the step's own
                      controls sit a step below on the same spacing. */}
                  {/* The gap under the agent — its name to the step's title —
                      is tighter than the step's other rows on purpose. The name
                      labels the character directly above it, so the two read as
                      one object; at the full row rhythm the name floated between
                      the character and the title and belonged to neither. 24px
                      against the 36px used elsewhere, a little over a third
                      less. `mb-9` still holds the block off the step content. */}
                  <div className="mb-9">
                    {/* The hero's room. Closed on the naming step — there is
                        no agent yet — and opened by the hand-off into the
                        agent step, the capsule springing up inside it as it
                        grows. The 24px under the name lives inside the room so
                        a closed room takes no space. A reload straight onto
                        the arc mounts it open, as before. */}
                    <motion.div
                      className="overflow-hidden"
                      initial={false}
                      animate={heroRoomTarget}
                      aria-hidden={step === 1 || undefined}
                    >
                    <motion.div
                      initial={capsuleHeroMotion.initial}
                      animate={capsuleTarget}
                      transition={capsuleHeroMotion.transition}
                      className="flex flex-col items-center gap-2 pb-6"
                    >
                      {/* Dozing and gray until the agent is actually hired.
                          Review is the first step where one exists, so that is
                          where it wakes and takes its colour — the arc's
                          payoff, not a flourish along it. The sequence itself
                          is the studio's export; see OnboardingCharacter. */}
                      <div className="relative size-(--sz-160px)">
                        <OnboardingCharacter appearance={agentAppearance} awake={step === 5} className="size-full" />
                      </div>
                      <AgentPreview agentName={agentName} agentRole="" />
                    </motion.div>
                    </motion.div>

                    <OnboardingHeading
                      center
                      // Keyed by step so the new words fade in where the old
                      // ones stood. Entrance only: the h1 keeps its line the
                      // whole time, so nothing below it moves for the swap.
                      title={
                        <motion.span key={step} {...titleSwapMotion} className="inline-block">
                          {step === 1
                            ? "Как называется ваша организация?"
                            : step === 3
                              ? "Создайте первого агента"
                              : step === 4
                                ? isLocalApi ? "Подключение модели" : "Connect a model"
                                : "Всё готово к работе"}
                        </motion.span>
                      }
                    />
                    {/* The lede lives outside the heading primitive so its
                        room can open and close. The agent step carries none,
                        as the prototype has it: the capsule and the heading
                        say what this is, and a sentence restating it only
                        pushes the fields down. The 8px gap sits inside the
                        clipped box so a closed lede takes no space at all.
                        The naming step carries none either: the question is
                        the whole screen, and Cloud's naming step (which most
                        walkers see instead) is drawn the same way. */}
                    <motion.div
                      className="overflow-hidden text-center"
                      initial={false}
                      animate={step === 1 || step === 3 ? ledeMotion.closed : ledeMotion.open}
                      aria-hidden={step === 1 || step === 3 || undefined}
                    >
                      <p className="pt-2 text-base leading-relaxed text-muted-foreground">
                        <motion.span key={step} {...titleSwapMotion} className="inline-block">
                          {step === 4
                            ? isLocalApi ? "Укажите адрес локального или корпоративного API." : "Paperclip works with your subscription or API keys."
                            : `${agentName.trim() || "Ваш первый агент"} готов к работе!`}
                        </motion.span>
                      </p>
                    </motion.div>
                  </div>
                </MotionConfig>
              )}

              {/* Step content */}
              {/* Steps 1, 3 and 4 hand their content over inside one presence:
                  the departing step fades and gives its room back before the
                  next opens its own, so the footer slides rather than jumps.
                  See stepContentMotion. */}
              {/* `initial` only for an arrival: the step's content opens its
                  room with the hero's instead of being there already. */}
              <AnimatePresence mode={stepHandoff ? "wait" : "sync"} initial={arrival}>
              {/* Step 1: name the organization — the wizard's first screen now
                  that the Build / Grow front door is gone. Its heading and
                  welcome sit in the shared block above, so the walk into the
                  agent step swaps words rather than screens. The field is the
                  agent step's field: same label, same filled surface, same
                  measure — the two questions the wizard asks present the same
                  target. */}
              {step === 1 && (
                <motion.div key="step-1" {...stepContentMotion} exit={stepHandoff ? stepContentMotion.exit : undefined} className="mx-auto flex w-full flex-col gap-9">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="onboarding-company-name">Название организации</Label>
                    <Input
                      id="onboarding-company-name"
                      className="h-(--sz-44px) rounded-lg border-transparent bg-muted shadow-none dark:bg-muted"
                      placeholder="Например, Сказ"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && companyName.trim()) {
                          e.preventDefault();
                          void handleCreateCompany();
                        }
                      }}
                      autoFocus
                    />
                  </div>
                </motion.div>
              )}

              {/* Step 3: the name, and only the name. The role picker went with
                  the question it was asking — a customer naming their first
                  agent is describing what it does, and the placeholder carries
                  the range of answers that fit. Hiring uses the neutral
                  `general` role; a specific one can be set later, where there
                  is context to choose it in. */}
              {step === 3 && (
                <motion.div key="step-3" {...stepContentMotion} exit={stepHandoff ? stepContentMotion.exit : undefined} className="mx-auto flex w-full flex-col gap-9">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="onboarding-agent-name">Имя агента</Label>
                    {/*
                      Filled, not outlined, and the column's full width — the
                      same field the naming step before the hand-off draws.
                      `bg-muted` is the design's field surface; the default
                      Input is a hairline border over `bg-input/30`, which on
                      this ground reads as an empty outline rather than a place
                      to type. The border is kept but made transparent so the
                      focus ring, which colours the border, still has one.
                    */}
                    <Input
                      id="onboarding-agent-name"
                      className="h-(--sz-44px) rounded-lg border-transparent bg-muted shadow-none dark:bg-muted"
                      placeholder="Например, Координатор"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && agentName.trim()) {
                          e.preventDefault();
                          setStep(4);
                        }
                      }}
                      autoFocus
                    />
                  </div>
                </motion.div>
              )}

              {/* Step 4: Connect a model — adapter + model + env check (capsule above) */}
              {step === 4 && (
                <motion.div key="step-4" {...stepContentMotion} exit={stepHandoff ? stepContentMotion.exit : undefined} className="space-y-8">
                  <div className="flex items-center justify-center gap-3">
                    <PaperclipLockup title="Сказ" className="h-8 w-auto" />
                  </div>
                  <OnboardingLoginCard instruction="Корпоративный или локальный API">
                    <div className="space-y-3">
                    <label className="block space-y-1 text-xs text-muted-foreground">URL API<OnboardingCardField label="URL API" placeholder="http://localhost:11434/v1" value={localBaseUrl} disabled={loading || adapterEnvLoading} onSubmit={handleConnectStepPrimary}
                      onChange={value => { setLocalBaseUrl(value); setApiKey(""); apiKeySecretRef.current = null; }} /></label>
                    <label className="block space-y-1 text-xs text-muted-foreground">Модель<OnboardingCardField label="Модель" placeholder="qwen3-coder:30b" value={model.replace(/^local\//, "")} onChange={setModel} disabled={loading || adapterEnvLoading} onSubmit={handleConnectStepPrimary} /></label>
                    <label className="block space-y-1 text-xs text-muted-foreground">Ключ API (необязательно)<OnboardingCardField label="Ключ API (необязательно)" placeholder="Оставьте пустым для сервера без авторизации" masked value={apiKey} onChange={setApiKey} disabled={loading || adapterEnvLoading} onSubmit={handleConnectStepPrimary} /></label>
                    <p className="text-xs text-muted-foreground">Запросы идут только на указанный сервер. Если он работает без авторизации, оставьте ключ пустым.</p>
                    </div>
                  </OnboardingLoginCard>
                  {!sourceSelected && <p role="alert" className="text-sm text-destructive">Локальный движок недоступен. Проверьте установку Pi на сервере.</p>}
                  {visibleAdapterEnvError && <details className="text-sm text-destructive"><summary>Не удалось проверить подключение</summary><p>{visibleAdapterEnvError}</p></details>}
                  {adapterEnvResult?.status === "fail" && <details className="text-sm text-destructive"><summary>Подробности проверки</summary>{adapterEnvResult.checks.map(check => <p key={check.code}>{check.message}</p>)}</details>}
                </motion.div>
              )}
              </AnimatePresence>

              {/* Step 5: Review — lead is online (shared capsule above) */}
              {/* Step 5: nothing. The heading names the agent and says it is
                  ready, and the pill above has just woken to show it — a
                  checklist restating those in three rows only asked the
                  customer to audit work they watched happen. */}

              {/* Error */}
              {visibleError && (
                <div className="mt-3">
                  <p role="alert" className="text-xs text-destructive">{displayError}</p>
                  {visibleError !== displayError && <details className="text-xs text-muted-foreground"><summary>Технические сведения</summary><p>{visibleError}</p></details>}
                </div>
              )}

              {/* Step 1 shares the arc's footer so the pair keeps its shape and
                  position from the first screen onward. It has no Back: step 1
                  is the first screen now that the front door is gone, and
                  `canGoBackFromOnboardingStep` returns false for it. */}
              {(isAgentArcStep || step === 1) && (
                <FooterNav
                  onBack={
                    // On the connect step Back unwinds the sign-in first, and
                    // only means "the previous step" once nothing is running.
                    step === 4 && connectPhase !== "idle"
                      ? unwindConnectStep
                      : canGoBackFromOnboardingStep({ currentStep: step, entryStep })
                        ? () => setStep(backStepFrom(step))
                        : undefined
                  }
                  // The prototype's cloud flow hires on this step and calls the
                  // action "Create". Here the model step sits between, so this
                  // one advances — which is exactly the distinction the
                  // prototype's own local flow draws with "Next".
                  primaryLabel={
                    step === 1
                      ? "Продолжить"
                      : step === 5
                        ? "Начать работу"
                        : step === 4
                          ? connectCta.label
                          : "Далее"
                  }
                  primaryIcon={step === 4 ? connectCta.icon : undefined}
                  loadingLabel={
                    step === 1
                      ? "Создание…"
                      : step === 4
                        ? "Подключение…"
                        : "Запуск…"
                  }
                  // The browser-code login is finished on this screen, so the
                  // button is genuinely busy for its duration and shows it. The
                  // displayed-code login is not — see `loginSubmitsBrowserCode`
                  // — so it stays a still, disabled Next instead of spinning
                  // against work happening in another tab.
                  // Step 4 says what it is doing through `connectCta` instead:
                  // it has four faces and only two of them are the step working.
                  loading={step === 3 || step === 4 ? false : loading}
                  primaryDisabled={
                    step === 1
                      ? !companyName.trim() || loading
                      : step === 3
                        ? !agentName.trim()
                        : step === 4
                          ? connectCta.disabled || loading
                          : loading || launchStateIncomplete
                  }
                  onPrimary={() => {
                    if (step === 1) void handleCreateCompany();
                    else if (step === 3) setStep(4);
                    // One button, two jobs — start the sign-in, or hire — and
                    // Cmd+Enter has to do the same thing. See
                    // `handleConnectStepPrimary`.
                    else if (step === 4) handleConnectStepPrimary();
                    else handleLaunchToDashboard();
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

function AdapterEnvironmentResult({
  result
}: {
  result: AdapterEnvironmentTestResult;
}) {
  const statusLabel =
    result.status === "pass"
      ? "Passed"
      : result.status === "warn"
      ? "Warnings"
      : "Failed";
  const statusClass =
    result.status === "pass"
      ? "text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10"
      : result.status === "warn"
      ? "text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
      : "text-red-700 dark:text-red-300 border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10";

  return (
    <div className={`rounded-md border px-2.5 py-2 text-(length:--text-micro) ${statusClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{statusLabel}</span>
        <span className="opacity-80">
          {new Date(result.testedAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {result.checks.map((check, idx) => (
          <div
            key={`${check.code}-${idx}`}
            className="leading-relaxed break-words"
          >
            <span className="font-medium uppercase tracking-wide opacity-80">
              {check.level}
            </span>
            <span className="mx-1 opacity-60">·</span>
            <span>{check.message}</span>
            {check.detail && (
              <span className="block opacity-75 break-all">
                ({check.detail})
              </span>
            )}
            {check.hint && (
              <span className="block opacity-90 break-words">
                Hint: {check.hint}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
