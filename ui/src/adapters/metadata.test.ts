import { describe, expect, it } from "vitest";
import { isEnabledAdapterType, isValidAdapterType, isVisualAdapterChoice, listAdapterOptions } from "./metadata";
import { getUIAdapter } from "./registry";

describe("local-only adapter metadata", () => {
  it("offers only Pi even if legacy and external adapters are registered", () => {
    expect(listAdapterOptions(type => type).map(adapter => adapter.value)).toEqual(["pi_local"]);
    expect(listAdapterOptions(type => type, [getUIAdapter("pi_local"), getUIAdapter("codex_local"), getUIAdapter("external_test")]).map(adapter => adapter.value)).toEqual(["pi_local"]);
    for (const type of ["pi_local", "codex_local", "paperclip_runner", "process", "http", "external_test"]) {
      expect(isEnabledAdapterType(type)).toBe(type === "pi_local");
      expect(isValidAdapterType(type)).toBe(type === "pi_local");
      expect(isVisualAdapterChoice(type)).toBe(type === "pi_local");
    }
  });
});
