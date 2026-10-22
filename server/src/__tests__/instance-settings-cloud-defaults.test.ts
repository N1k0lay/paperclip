import { describe, expect, it } from "vitest";
import { INSTANCE_FEATURE_CATALOG } from "@paperclipai/shared";
import {
  applyCloudCatalogDefaults,
  applyExperimentalSettingsPatch,
  applyManagedExperimentalOverlay,
  normalizeExperimentalSettings,
  stripCloudCatalogDefaultEchoes,
} from "../services/instance-settings.js";
import type { ManagedInstanceConfig } from "../services/managed-config.js";

function managedConfig(features: ManagedInstanceConfig["features"] = {}): ManagedInstanceConfig {
  return {
    v: 1,
    mode: "cloud",
    catalogVersion: "test",
    features,
    plugins: { autoInstall: [] },
    environments: [],
  };
}

describe("applyCloudCatalogDefaults", () => {
  it("keeps the optional native runner off for new local and Cloud instances", () => {
    expect(INSTANCE_FEATURE_CATALOG.enableNativeRunner.selfHostedDefault).toBe(false);
    expect(INSTANCE_FEATURE_CATALOG.enableNativeRunner.cloudDefault).toBe(false);
  });

  it("leaves self-hosted instances on the schema default", () => {
    const experimental = applyCloudCatalogDefaults(normalizeExperimentalSettings({}), {}, null);
    expect(experimental.enableNativeRunner).toBe(false);
  });

  it("re-asserts the Cloud default when the tenant row and the overlay omit the flag", () => {
    const experimental = applyCloudCatalogDefaults(
      normalizeExperimentalSettings({}),
      {},
      managedConfig(),
    );
    expect(experimental.enableNativeRunner).toBe(false);
    // Flags with matching defaults are untouched.
    expect(experimental.enableStreamlinedUi).toBe(true);
  });

  it("keeps an explicit tenant value", () => {
    const raw = { enableNativeRunner: true };
    const experimental = applyCloudCatalogDefaults(
      normalizeExperimentalSettings(raw),
      raw,
      managedConfig(),
    );
    expect(experimental.enableNativeRunner).toBe(true);
  });

  it("lets a managed feature value win through the overlay", () => {
    const config = managedConfig({ enableNativeRunner: true });
    const { experimental } = applyManagedExperimentalOverlay(
      applyCloudCatalogDefaults(normalizeExperimentalSettings({}), {}, config),
      config,
    );
    expect(experimental.enableNativeRunner).toBe(true);
  });

  it("does not touch flags whose Cloud default is the enabled one", () => {
    // enableOwnerInstanceAdmin defaults off for self-hosted and on for Cloud.
    // That direction is resolved elsewhere; this helper must not flip it.
    const experimental = applyCloudCatalogDefaults(
      normalizeExperimentalSettings({}),
      {},
      managedConfig(),
    );
    expect(experimental.enableOwnerInstanceAdmin).toBe(false);
  });
});

describe("stripCloudCatalogDefaultEchoes", () => {
  /** What `updateExperimental` would persist for a given row and patch. */
  function persisted(rawStored: unknown, patch: Record<string, unknown>, config: ManagedInstanceConfig | null) {
    return stripCloudCatalogDefaultEchoes(
      rawStored,
      patch,
      applyExperimentalSettingsPatch(rawStored, patch),
      config,
    ) as Record<string, unknown>;
  }

  /** What a later read of that persisted row shows. */
  function readBack(stored: Record<string, unknown>, config: ManagedInstanceConfig | null) {
    return applyManagedExperimentalOverlay(
      applyCloudCatalogDefaults(normalizeExperimentalSettings(stored), stored, config),
      config,
    ).experimental;
  }

  it("keeps matching local and Cloud defaults off during an unrelated write", () => {
    const config = managedConfig();
    const stored = persisted({}, { enableStatusCards: true }, config);
    expect(stored.enableStatusCards).toBe(true);
    expect(stored.enableNativeRunner).toBe(false);
    expect(readBack(stored, config).enableNativeRunner).toBe(false);
  });

  it("keeps an echoed matching local and Cloud default off", () => {
    const config = managedConfig();
    const stored = persisted({}, { enableNativeRunner: false, enableStatusCards: true }, config);
    expect(stored.enableNativeRunner).toBe(false);
    expect(readBack(stored, config).enableNativeRunner).toBe(false);
  });

  it("persists an explicit Cloud opt-in", () => {
    const config = managedConfig();
    const stored = persisted({}, { enableNativeRunner: true }, config);
    expect(stored.enableNativeRunner).toBe(true);
    expect(readBack(stored, config).enableNativeRunner).toBe(true);
  });

  it("keeps a stored tenant value across unrelated writes", () => {
    const config = managedConfig();
    const stored = persisted({ enableNativeRunner: true }, { enableStatusCards: true }, config);
    expect(stored.enableNativeRunner).toBe(true);
    expect(readBack(stored, config).enableNativeRunner).toBe(true);
  });

  it("leaves the whole normalized object in place for self-hosted rows", () => {
    const stored = persisted({}, { enableStatusCards: true }, null);
    expect(stored.enableNativeRunner).toBe(false);
    expect(stored).toEqual(applyExperimentalSettingsPatch({}, { enableStatusCards: true }));
  });
});
