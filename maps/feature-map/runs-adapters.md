---
navigation: {"section":"Agents and reusable capabilities","sectionOrder":30,"order":20}
---

# Runs, harnesses, and model accounts

Сказ connects agents to an explicit local or corporate OpenAI-compatible URL through Pi with the legacy runner. Operators inspect execution history and transcripts separately from connection-test results.

Feature ID: `runs-adapters`.

Implementation: [adapter manager](../../ui/src/pages/AdapterManager.tsx), [run host](../../ui/src/pages/AgentDetail.tsx), [configuration](../../ui/src/components/AgentConfigForm.tsx).

Agent access: [companion](../agent-access-map/runs-adapters.md).

## Sub-features

- `availability`: `runs-adapters/availability` — inspect the local Pi adapter and configure the endpoint, model ID, and optional API key.
- `validation`: `runs-adapters/validation` — test an adapter in the selected execution environment and surface authentication failures.
- `runs`: `runs-adapters/runs` — inspect run status, events, output, costs, and the source task.
- `session`: `runs-adapters/session` — preserve or reset execution context through supported lifecycle actions.

## How to get to it (user POV)

### `adapter-setup`

Open an agent’s model/adapter configuration or the instance adapter settings page when permitted.

### `run-history`

Open an agent run at `/agents/:agentId/runs/:runId` from the agent or task activity.
The agent header has one Run now action. Administrators can enable
Capture raw provider traces under the agent configuration’s Debugging section
for future runs. The header shows Raw tracing on while that setting is enabled.

For latency diagnosis with an operator OTLP endpoint, search the hashed run ID
without restricting the root span name. Compare workspace preparation with its
`workspace_<step>` intervals. Measure controller readiness separately through
`controller.startup.<phase>`. A recovery pause or deployment drain is not model
execution time. See the [tracing contract](../../doc/observability.md#controller-preparation-phases).
These source-level diagnostics do not establish a live response-time budget.
Inspect `native.controller.<phase>` for backend construction, assigned-tool
discovery and post-turn cleanup. Compare those intervals with the actual model
turn; do not count a nested discovery interval twice.

## Driving it with Playwright and the Paperclip CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Record the endpoint, model, and execution environment. Keep API keys out of logs and evidence.

### `adapter-setup`

Automated: [adapter validation routes](../../server/src/__tests__/agent-adapter-validation-routes.test.ts), [local provider API guards](../../server/src/__tests__/local-provider-routes.test.ts), and [local-only policy](../../server/src/adapters/local-only-policy.test.ts) cover endpoint validation and rejection of external providers.

Manual: Enter a local or corporate URL, exact model ID, and optional API key.
Run the connection test, save, reload, and execute a small task that reads and
writes a file. Repeat with no key for a server without authorization, an invalid
URL, and an unavailable model. Failures must remain visible. Changing the URL
must clear the previous endpoint's credential selection.

Only `pi_local` with the legacy runner is selectable. Server creation, testing,
and execution reject cloud adapters, managed account bindings, native runners,
and adapter plugin overrides. Existing records remain available as history;
convert their configuration explicitly before running them.

### `run-history`

Automated: [live run routes](../../server/src/__tests__/agent-live-run-routes.test.ts) and [run event sequencing](../../server/src/__tests__/heartbeat-run-event-sequencing.test.ts) cover run data contracts.

Manual: Start a disposable task, open its running transcript, and follow it to a terminal outcome. Reload and compare task/run IDs, status, output, and cost. Verify a failed run remains distinguishable from a completed run with useful output.

An explicit runner change starts a configuration revision and invalidates the
eligible session. Active runs, restart recovery and historical transcript parsing
retain their recorded execution configuration; do not infer their runner from a
later edit to the agent. Account/harness branding and execution identity are
different observations, both required in the evidence.

For an onboarding child-completion callback, verify actual session/turn events
and the source-correlated reply. A `succeeded` row alone is insufficient: the
literal `ea6c8eb5e16d61111968f633a66748b397b64a3e` managed attempt was marked
successful during startup without a provider turn. The recovery correction
preserves the existing validated Done-parent handoff; process-death and ownership
checks remain active. Its PostgreSQL controls are separate from the required
revised-source live onboarding and follow-up proof.

## Gotchas

- Configure the model URL and secret in the agent settings. Cloud AI account setup and model routing pools are disabled in this fork. Ordinary tool integrations remain separate.

- The run log is instance database data; it is not the opt-out first-party Telemetry system or operator-configured OpenTelemetry tracing.
- Authentication/model discovery does not establish tool, image, steering, or resumption capability parity.
- Use [recovery](./recovery.md) for interrupted runs and [execution environments](./execution-environments.md) for local/SSH/sandbox differences.
