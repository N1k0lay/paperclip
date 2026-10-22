/** Agent creation uses an explicit local or corporate OpenAI-compatible API. */
export function isNewAgentAdapterAllowed(
  type: string,
  _options?: { cloud: boolean; nativeRunnerEnabled: boolean; openAiDotEnabled?: boolean; museEnabled?: boolean; runnerProvider?: string },
) {
  return type === "pi_local";
}
