import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTelemetryConfig } from "./config.js";

describe("Skrepka telemetry opt-in", () => {
  beforeEach(() => {
    for (const name of ["PAPERCLIP_TELEMETRY_DISABLED", "DO_NOT_TRACK", "CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "GITHUB_ACTIONS", "GITLAB_CI"]) {
      vi.stubEnv(name, undefined);
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stays disabled without explicit consent", () => {
    expect(resolveTelemetryConfig().enabled).toBe(false);
    expect(resolveTelemetryConfig({ enabled: false }).enabled).toBe(false);
  });

  it("honors explicit consent", () => {
    expect(resolveTelemetryConfig({ enabled: true }).enabled).toBe(true);
  });

  it.each(["PAPERCLIP_TELEMETRY_DISABLED", "DO_NOT_TRACK", "CI"])("%s overrides consent", (name) => {
    vi.stubEnv(name, "1");
    expect(resolveTelemetryConfig({ enabled: true }).enabled).toBe(false);
  });
});
