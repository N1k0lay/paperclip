import { i18n, useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { Clock3, FileDiff, GitCommit, type LucideIcon } from "lucide-react";
import { healthApi, type HealthStatus } from "@/api/health";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return i18n.t("server.unavailable", { ns: "shell" });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return i18n.t("server.unavailable", { ns: "shell" });
  return new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isValidTimestamp(value: string | null | undefined): value is string {
  return !!value && !Number.isNaN(new Date(value).getTime());
}

function restartTimestamp(health: HealthStatus | undefined): string | null {
  return health?.devServer?.lastRestartAt ?? health?.serverInfo?.processStartedAt ?? null;
}

function commitLabel(health: HealthStatus | undefined): string {
  const git = health?.serverInfo?.git;
  if (!git?.available) return i18n.t("server.commitUnavailable", { ns: "shell" });
  return `${git.shortSha} · ${git.subject}`;
}

function localChangesLabel(health: HealthStatus | undefined): string {
  const git = health?.serverInfo?.git;
  if (!git?.available) return i18n.t("server.unavailable", { ns: "shell" });
  const localChanges = git.localChanges;
  if (!localChanges) return i18n.t("server.changesUnavailable", { ns: "shell" });
  if (!localChanges.available) return i18n.t("server.changesUnavailable", { ns: "shell" });
  if (!localChanges.hasLocalChanges) return i18n.t("server.clean", { ns: "shell" });

  const parts = [
    [localChanges.stagedFileCount, i18n.t("server.staged", { ns: "shell" })],
    [localChanges.unstagedFileCount, i18n.t("server.unstaged", { ns: "shell" })],
    [localChanges.untrackedFileCount, i18n.t("server.untracked", { ns: "shell" })],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`);

  return parts.length > 0 ? i18n.t("server.localChangesDetail", { ns: "shell", details: parts.join(", ") }) : i18n.t("server.localChanges", { ns: "shell" });
}

function ServerInfoRow({
  icon: Icon,
  label,
  value,
  dateTime,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  dateTime?: string | null;
}) {
  return (
    <div className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left">
      <span className="mt-0.5 rounded-lg border border-border bg-background/70 p-2 text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {dateTime ? (
          <time dateTime={dateTime} className="block break-words text-xs text-muted-foreground">
            {value}
          </time>
        ) : (
          <span className="block break-words text-xs text-muted-foreground">{value}</span>
        )}
      </span>
    </div>
  );
}

export function SidebarServerInfo() {
  const { t } = useTranslation("shell");
  const experimentalQuery = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const enabled = experimentalQuery.data?.enableServerInfoDebugView === true;
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    enabled,
    // The drawer only mounts while the account popover is open, so it cannot
    // rely on Layout's background health poll (which is itself gated on
    // devServer.enabled). Always refetch on open and poll while open so a server
    // restart is reflected without leaving stale boot-time serverInfo on screen.
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const data = query.state.data as HealthStatus | undefined;
      return data?.devServer?.enabled ? 2000 : false;
    },
  });

  if (!enabled) return null;

  const health = healthQuery.data;
  const isWaitingForHealth = healthQuery.isLoading && !health;
  const healthUnavailable = healthQuery.isError;
  const restartedAt = restartTimestamp(health);
  const restartedAtIsValid = isValidTimestamp(restartedAt);
  const lastRestartedLabel = healthUnavailable
    ? t("server.healthUnavailable")
    : isWaitingForHealth
      ? t("server.loading")
      : formatTimestamp(restartedAt);
  const commit = healthUnavailable
    ? t("server.healthUnavailable")
    : isWaitingForHealth
      ? t("server.loading")
      : commitLabel(health);
  const localChanges = healthUnavailable
    ? t("server.healthUnavailable")
    : isWaitingForHealth
      ? t("server.loading")
      : localChangesLabel(health);

  return (
    <div className="mt-2 border-t border-border pt-2">
      <p className="px-3 pb-1 pt-1 text-(length:--text-micro) font-medium uppercase tracking-wide text-muted-foreground">
        {t("server.title")}
      </p>
      <ServerInfoRow
        icon={Clock3}
        label={t("server.lastRestarted")}
        value={lastRestartedLabel}
        dateTime={!healthUnavailable && !isWaitingForHealth && restartedAtIsValid ? restartedAt : null}
      />
      <ServerInfoRow icon={GitCommit} label={t("server.runningCommit")} value={commit} />
      <ServerInfoRow icon={FileDiff} label={t("server.checkout")} value={localChanges} />
    </div>
  );
}
