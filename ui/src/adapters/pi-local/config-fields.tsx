import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function PiLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  return configFieldsForSection(section, (<>
    <Field label="URL локального API" hint="OpenAI-совместимый API, например http://localhost:11434/v1.">
      <DraftInput value={isCreate ? String(values?.adapterSchemaValues?.baseUrl ?? "") : eff("adapterConfig", "baseUrl", String(config.baseUrl ?? ""))}
        onCommit={value => isCreate ? set!({ adapterSchemaValues: { ...values?.adapterSchemaValues, baseUrl: value } }) : mark("adapterConfig", "baseUrl", value || undefined)}
        immediate className={inputClass} placeholder="http://localhost:11434/v1" />
    </Field>
    {!hideInstructionsFile && <Field label="Agent instructions file" hint={instructionsFileHint}>
      <div className="flex items-center gap-2">
        <DraftInput
          value={
            isCreate
              ? values!.instructionsFilePath ?? ""
              : eff(
                  "adapterConfig",
                  "instructionsFilePath",
                  String(config.instructionsFilePath ?? ""),
                )
          }
          onCommit={(v) =>
            isCreate
              ? set!({ instructionsFilePath: v })
              : mark("adapterConfig", "instructionsFilePath", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="/absolute/path/to/AGENTS.md"
        />
        <ChoosePathButton />
      </div>
    </Field>}
  </>));
}
