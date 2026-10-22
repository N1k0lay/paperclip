import { describe, expect, it } from "vitest";
import { isNewAgentAdapterAllowed } from "./new-agent-adapters";

describe("local-only agent policy", () => {
  it.each([false, true])("only permits Pi with cloud=%s and all experiments enabled", cloud => {
    const options = { cloud, nativeRunnerEnabled: true, openAiDotEnabled: true, museEnabled: true, runnerProvider: "copilot" };
    for (const type of ["claude_local", "codex_local", "paperclip_runner", "openai_dot", "muse", "external_test", "process", "http"]) {
      expect(isNewAgentAdapterAllowed(type, options)).toBe(false);
    }
    expect(isNewAgentAdapterAllowed("pi_local", options)).toBe(true);
  });
});
