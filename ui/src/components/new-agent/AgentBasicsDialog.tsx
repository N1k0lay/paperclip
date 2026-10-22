import { useCompany } from "@/context/CompanyContext";
import { useAgentAppearanceDraft } from "@/hooks/useAgentAppearanceDraft";
import { AgentCharacter } from "../AgentCharacter";
import { useEffect, useId, useRef, useState } from "react";
import type { Agent } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { buildNewAgentRuntimeConfig } from "@/lib/new-agent-runtime-config";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

export type AgentBasics = {
  name: string;
  adapterType: string;
  runnerProvider: string;
  runner: string;
  setupAgentId: string;
};
export { AdapterMark } from "../AdapterMark";

export function AgentBasicsDialog({
  open,
  onClose,
  onContinue,
  initialName = "",
  setupAgentId,
}: {
  open: boolean;
  onClose: () => void;
  onContinue: (basics: AgentBasics) => void;
  initialAdapter?: string;
  initialName?: string;
  setupAgentId?: string;
  onInvite?: () => void;
}) {
  const id = useId();
  const { selectedCompanyId: companyId } = useCompany();
  const cache = useQueryClient();
  const appearanceDraft = useAgentAppearanceDraft(`${companyId}:new-agent`);
  const setupId = useRef(setupAgentId ?? crypto.randomUUID());
  const saved = useRef<Agent | null>(null);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState(initialName);

  async function submit() {
    if (busy.current || !name.trim()) return;
    busy.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (!companyId) throw new Error("Выберите организацию для создания агента.");
      let agent = saved.current;
      if (!agent && setupAgentId) agent = await agentsApi.get(setupId.current, companyId);
      if (!agent) {
        const existing = (await agentsApi.list(companyId)).filter(item => item.id !== setupId.current);
        const leader = existing.find(item => item.role === "ceo" && item.status !== "terminated");
        agent = await agentsApi.create(companyId, {
          setupId: setupId.current, name: name.trim(), appearance: appearanceDraft.appearance,
          role: existing.length ? "general" : "ceo", ...(leader ? { reportsTo: leader.id } : {}),
          adapterType: "pi_local", runner: "legacy", adapterConfig: {},
          runtimeConfig: buildNewAgentRuntimeConfig({ heartbeatEnabled: false }),
        });
      } else if (agent.name !== name.trim() || agent.metadata?.setupAdapterPending) {
        agent = await agentsApi.update(agent.id, {
          name: name.trim(), adapterType: "pi_local", runner: "legacy",
          metadata: { ...agent.metadata, setupAdapterPending: false },
        }, companyId);
      }
      saved.current = agent;
      cache.setQueryData(queryKeys.agents.detail(agent.id), agent);
      void cache.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      if (active.current) onContinue({ name: agent.name, adapterType: "pi_local", runnerProvider: "pi",
        runner: "legacy", setupAgentId: agent.id });
    } catch (cause) {
      if (active.current) setSaveError(cause instanceof Error ? cause.message : "Не удалось сохранить настройку агента.");
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
      <DialogContent className="flex max-h-(--sz-calc-18) flex-col gap-0 overflow-hidden p-0 sm:max-w-(--sz-560px)">
        <form className="flex min-h-0 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <div className="flex min-h-0 flex-col gap-7 overflow-y-auto px-6 py-8 sm:px-10">
            <div className="flex flex-col items-center gap-4 text-center">
              {open && <AgentCharacter appearance={appearanceDraft.appearance} state="sleepy" muted size={256} className="size-48" trackingScope="page" />}
              <div className="space-y-2">
                <DialogTitle className="text-3xl font-semibold tracking-tight">Новый агент</DialogTitle>
                <DialogDescription className="text-base">Как назовём агента?</DialogDescription>
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor={id} className="text-sm font-medium">Имя агента</label>
              <Input id={id} autoFocus disabled={saving} maxLength={100} placeholder="Например, Алексей" value={name}
                onChange={event => setName(event.target.value)} className="h-12 text-base" />
              <p className="text-sm text-muted-foreground">Далее укажите URL локального или корпоративного API и модель.</p>
            </div>
          </div>
          {saveError && <p role="alert" className="px-6 pb-4 text-sm text-destructive">{saveError}</p>}
          <div className="flex justify-between gap-4 border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Сохранение…" : "Настроить агента"}<ArrowRight className="size-4" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
