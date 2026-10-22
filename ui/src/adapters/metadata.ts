/**
 * Adapter metadata utilities — built on top of the display registry and UI adapter list.
 *
 * This module bridges the static display metadata with the dynamic adapter registry.
 * "Coming soon" status is derived from the display registry's `comingSoon` flag.
 * "Hidden" status comes from the disabled-adapter store (server-side toggle).
 */
import type { UIAdapterModule } from "./types";
import { listUIAdapters } from "./registry";
import { isAdapterTypeHidden } from "./disabled-store";
import { getAdapterLabel, getAdapterDisplay } from "./adapter-display-registry";

export interface AdapterOptionMetadata {
  value: string;
  label: string;
  comingSoon: boolean;
  hidden: boolean;
  experimental: boolean;
}

export function listKnownAdapterTypes(): string[] {
  return listUIAdapters().map((adapter) => adapter.type);
}

/** Historical parsers remain registered; only the local runtime is selectable. */
export function isEnabledAdapterType(type: string): boolean {
  return type === "pi_local";
}

export function isValidAdapterType(type: string): boolean {
  return type === "pi_local";
}

export function isVisualAdapterChoice(type: string): boolean {
  return type === "pi_local";
}

/**
 * Build option metadata for a list of adapters (for dropdowns).
 * `labelFor` callback allows callers to override labels; defaults to display registry.
 */
export function listAdapterOptions(
  labelFor?: (type: string) => string,
  adapters: UIAdapterModule[] = listUIAdapters(),
): AdapterOptionMetadata[] {
  const getLabel = labelFor ?? getAdapterLabel;
  return adapters.filter(adapter => adapter.type === "pi_local").map((adapter) => ({
    value: adapter.type,
    label: getLabel(adapter.type),
    comingSoon: !!getAdapterDisplay(adapter.type).comingSoon,
    hidden: isAdapterTypeHidden(adapter.type),
    experimental: !!getAdapterDisplay(adapter.type).experimental,
  }));
}

/**
 * List UI adapters excluding those hidden via the Adapters settings page.
 */
export function listVisibleUIAdapters(): UIAdapterModule[] {
  return listUIAdapters().filter((a) => !isAdapterTypeHidden(a.type));
}

/**
 * List visible adapter types (for non-React contexts like module-level constants).
 */
export function listVisibleAdapterTypes(): string[] {
  return listVisibleUIAdapters().map((a) => a.type);
}
