import type { ReactNode } from "react";
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import type { AuthSession } from "@paperclipai/shared";
import { Card } from "@/components/ui/card";

type BootstrapPendingPageProps = {
  claimAvailable: boolean;
  hasActiveInvite?: boolean;
  session: AuthSession | null | undefined;
  claimState: "idle" | "claiming" | "success";
  claimError?: { status?: number; message?: string } | null;
  onClaim: () => void;
};

function StateChrome({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Card className="block p-6">{children}</Card>
    </div>
  );
}

function displayIdentity(session: AuthSession) {
  return session.user.email || session.user.name || session.user.id;
}

function claimErrorCopy(error: BootstrapPendingPageProps["claimError"]) {
  if (error?.status === 409) {
    return {
      title: "Администратор этого сервера уже назначен.",
      body: "Обновите страницу для входа или попросите администратора пригласить вас через настройки доступа.",
    };
  }
  if (error?.status === 401) {
    return {
      title: "Сессия истекла. Войдите снова, чтобы стать администратором.",
      body: "",
    };
  }
  return {
    title: "Не удалось связаться с сервером. Повторите попытку через несколько секунд.",
    body: "",
  };
}

export function BootstrapPendingPage({
  claimAvailable,
  hasActiveInvite = false,
  session,
  claimState,
  claimError,
  onClaim,
}: BootstrapPendingPageProps) {
  if (!claimAvailable) {
    return (
      <StateChrome>
        <h1 className="text-xl font-semibold">Сказ ожидает первого администратора</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Доступ к этому серверу открывается по приглашению.
          {hasActiveInvite
            ? " Приглашение первого администратора уже создано. Получите ссылку у оператора сервера и откройте её в этом браузере."
            : " Получите у оператора сервера одноразовую ссылку для первого администратора и откройте её в этом браузере."}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          В публичном режиме назначение администратора без приглашения отключено.
        </p>
      </StateChrome>
    );
  }

  if (claimState === "success") {
    return (
      <StateChrome>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Вы стали администратором</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Сервер готов. Открываем настройку вашей первой организации…
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          <span className="text-sm text-muted-foreground">Переход к настройке…</span>
        </div>
        <div className="mt-5">
          <Button asChild variant="outline">
            <a href="/">Продолжить</a>
          </Button>
        </div>
      </StateChrome>
    );
  }

  if (!session) {
    return (
      <StateChrome>
        <h1 className="text-xl font-semibold">Завершите настройку Сказа</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          На этом сервере ещё нет администратора. Войдите или создайте учётную запись, чтобы стать первым администратором.
        </p>
        <div className="mt-5">
          <Button asChild>
            <Link to="/auth?next=/">Войти / Создать аккаунт</Link>
          </Button>
        </div>
      </StateChrome>
    );
  }

  const errorCopy = claimErrorCopy(claimError);
  const isClaiming = claimState === "claiming";
  return (
    <StateChrome>
      <h1 className="text-xl font-semibold">Завершите настройку Сказа</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        На этом сервере ещё нет администратора. Назначьте себя первым администратором и перейдите к созданию организации.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={onClaim} disabled={isClaiming}>
          {isClaiming && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          {isClaiming ? "Назначение…" : "Стать администратором"}
        </Button>
        <span className="text-sm text-muted-foreground">
          Вы вошли как <span className="font-medium text-foreground">{displayIdentity(session)}</span>
        </span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Другая учётная запись?{" "}
        <Link to="/auth?next=/" className="underline underline-offset-2">
          Сменить аккаунт
        </Link>
        .
      </p>
      {claimError && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{errorCopy.title}</p>
            {errorCopy.body && <p className="mt-1 text-destructive/90">{errorCopy.body}</p>}
          </div>
        </div>
      )}
    </StateChrome>
  );
}
