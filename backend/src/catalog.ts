import { type FeatureKey, tryParseFeatureKey } from './model/featureKey.js';
import { type Persona, canManage } from './model/persona.js';
import type { DefaultConfigRow } from './superposition/controlPlane.js';

export interface CatalogEntry {
  feature: FeatureKey;
  /** The workspace default, before any context applies. */
  value: unknown;
  schema: Record<string, unknown>;
  description: string;
}

/**
 * The catalog is derived from Superposition's default_configs, so there is no
 * sidecar file to drift out of sync with the keys that actually exist.
 *
 * A row whose key does not follow the scheme is skipped, not fatal: the admin
 * UI lets anyone add a key, and one stray row must not take the feature pages
 * down.
 */
export function buildCatalog(
  rows: readonly DefaultConfigRow[],
  warn: (message: string) => void = (message) => console.warn(message),
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const row of rows) {
    const feature = tryParseFeatureKey(row.key);
    if (!feature) {
      warn(
        `skipping default config ${JSON.stringify(row.key)}: not of the form ` +
          `<manageability>.<propagation>.<name>`,
      );
      continue;
    }
    entries.push({
      feature,
      value: row.value,
      schema: row.schema,
      description: row.description,
    });
  }
  return entries.sort((a, b) => a.feature.key.localeCompare(b.feature.key));
}

export function visibleCatalog(
  catalog: readonly CatalogEntry[],
  persona: Persona,
): CatalogEntry[] {
  return catalog.filter((entry) => canManage(persona, entry.feature));
}
