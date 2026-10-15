import type { ControlPlane } from '../../src/superposition/controlPlane.js';

export { ensureWorkspace } from '../../src/superposition/workspace.js';

/**
 * Superposition has no DeleteWorkspace operation, so integration tests cannot
 * drop their workspace. Instead one fixed workspace is reused and cleaned at
 * the START of each run - a crashed run therefore cannot poison the next.
 *
 * Named `featuredemotest`, not `featuredemo_test`: the live server validates
 * workspace names against `^[a-zA-Z0-9]+$` (see
 * crates/superposition/src/workspace/handlers.rs, validate_workspace_name) -
 * underscores and hyphens are rejected with a 400. Verified against the
 * running instance before picking this name.
 */
export const TEST_WORKSPACE = 'featuredemotest';

/**
 * Deleting contexts is enough of a reset: bootstrap is idempotent and rewrites
 * the feature defaults, so dimensions and default configs can stay. Contexts
 * must go first in any case - Superposition refuses to delete a default config
 * key still referenced by a context.
 */
export async function deleteAllContexts(controlPlane: ControlPlane): Promise<void> {
  for (const row of await controlPlane.listContexts()) {
    await controlPlane.deleteContext(row.id);
  }
}
