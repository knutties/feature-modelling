import { type SuperpositionClient, UpdateDimensionCommand } from 'superposition-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { makeClient } from '../../src/superposition/client.js';
import { CHANGE_REASON, SUPERPOSITION } from '../../src/superposition/config.js';
import { DIMENSION_SPECS, FEATURE_DEFAULTS, bootstrap } from '../../src/superposition/schema.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

let client: SuperpositionClient;
let cp: ControlPlane;

beforeAll(async () => {
  client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await deleteAllContexts(cp);
  await repairDriftedPositions();
  await bootstrap(cp);
});

/**
 * ControlPlane has no updateDimension - nothing in bootstrap() needs one -
 * so this test drives UpdateDimensionCommand directly to simulate a
 * workspace that drifted (a dimension moved by hand, or a crashed run).
 * Moving `killswitch` to `toPosition` and back are exact inverses of each
 * other server-side (the position update shifts every dimension strictly
 * between the old and new position by one, in the opposite direction each
 * time), so the second call restores the original arrangement exactly.
 */
async function moveDimension(dimension: string, toPosition: number): Promise<void> {
  await client.send(new UpdateDimensionCommand({
    org_id: SUPERPOSITION.orgId,
    workspace_id: TEST_WORKSPACE,
    dimension,
    position: toPosition,
    change_reason: CHANGE_REASON,
  }));
}

/**
 * Self-healing counterpart to `deleteAllContexts` above, for the same
 * reason: this workspace is shared across runs, and nothing deletes it
 * between them, so a crashed earlier run - or this file's own drift test
 * below, if its restore attempt failed twice - can leave a dimension at the
 * wrong position permanently. Left alone, every later `bootstrap()` call
 * against this workspace, in this file or any other sharing it, would then
 * fail at `assertDimensionPositions` forever, with no run ever able to fix
 * it. Repairing drift at the START of the run, before any test (including
 * the drift test) touches the workspace, is the same principle
 * `deleteAllContexts` already applies to contexts.
 */
async function repairDriftedPositions(): Promise<void> {
  const actual = new Map((await cp.listDimensions()).map((d) => [d.dimension, d.position]));
  for (const spec of DIMENSION_SPECS) {
    const current = actual.get(spec.name);
    if (current !== undefined && current !== spec.position) {
      await moveDimension(spec.name, spec.position);
    }
  }
}

/**
 * Restores `killswitch` to `toPosition`, retrying once on a transient
 * failure (a network blip or server hiccup) before giving up. This only
 * narrows the window in which a failed restore strands the workspace -
 * `repairDriftedPositions` above is what actually closes it on the next
 * run - so the thrown error says so explicitly rather than leaving whoever
 * hits it to guess.
 */
async function restoreKillswitchPosition(toPosition: number): Promise<void> {
  try {
    await moveDimension('killswitch', toPosition);
  } catch {
    try {
      await moveDimension('killswitch', toPosition);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to restore killswitch to position ${toPosition} after two attempts: ${message}. `
        + `${TEST_WORKSPACE} may now have killswitch at the wrong position - re-running this `
        + 'suite will repair it automatically, via repairDriftedPositions in beforeAll.',
      );
    }
  }
}

describe('bootstrap', () => {
  it('creates every dimension at its specified position', async () => {
    const byName = new Map((await cp.listDimensions()).map((d) => [d.dimension, d.position]));
    for (const spec of DIMENSION_SPECS) {
      expect(byName.get(spec.name)).toBe(spec.position);
    }
  });

  it('keeps the cohort at or below its parent dimension', async () => {
    const byName = new Map((await cp.listDimensions()).map((d) => [d.dimension, d.position]));
    expect(byName.get('customer_cohort')!).toBeLessThanOrEqual(byName.get('customer_id')!);
  });

  it('creates all four demo features with their defaults', async () => {
    const byKey = new Map((await cp.listDefaultConfigs()).map((r) => [r.key, r.value]));
    for (const feature of FEATURE_DEFAULTS) {
      expect(byKey.get(feature.key)).toEqual(feature.value);
    }
    expect(FEATURE_DEFAULTS).toHaveLength(4);
  });

  it('covers all four quadrants exactly once', async () => {
    const quadrants = FEATURE_DEFAULTS.map((f) => {
      const [manageability, propagation] = f.key.split('.');
      return `${manageability}/${propagation!.startsWith('copied') ? 'copied' : 'inherited'}`;
    });
    expect(new Set(quadrants).size).toBe(4);
  });

  it('is idempotent and resets values a run may have changed', async () => {
    const theme = 'external.copied_till_merchant.checkout_theme';
    await cp.putDefaultConfig(theme, 'neo', { type: 'string', enum: ['classic', 'neo', 'minimal'] }, 'drift');
    await bootstrap(cp);
    const byKey = new Map((await cp.listDefaultConfigs()).map((r) => [r.key, r.value]));
    expect(byKey.get(theme)).toBe('classic');
  });

  it('resolves every feature to its default for an unknown entity', async () => {
    const config = await cp.resolve({ org: 'nobody', killswitch: false });
    for (const feature of FEATURE_DEFAULTS) {
      expect(config[feature.key]).toEqual(feature.value);
    }
  });

  it('evaluates the local cohort from a customer id', async () => {
    // A query carrying customer_id must still resolve, and resolve to every
    // feature's default (no context overrides exist at this point in the
    // demo). This is what breaks when the cohort's JSONLogic is malformed:
    // a bad `definitions` entry makes the server either reject the resolve
    // call outright or silently misassign the cohort, either of which would
    // make at least one feature's resolved value diverge from its default.
    // The cohort's own effect on a value is proven in Task 9, where a cohort
    // override is written.
    const gold = await cp.resolve({ org: 'nobody', customer_id: 'cust_001', killswitch: false });
    for (const feature of FEATURE_DEFAULTS) {
      expect(gold[feature.key]).toEqual(feature.value);
    }
  });

  it('refuses to proceed when a dimension position has drifted from the spec', async () => {
    const killswitchSpec = DIMENSION_SPECS.find((spec) => spec.name === 'killswitch')!;
    await moveDimension('killswitch', 4);
    try {
      await expect(bootstrap(cp)).rejects.toThrow(/killswitch: expected 6, got 4/);
    } finally {
      // Moving it back is the exact inverse of the drift above, restoring
      // every dimension's position - not just killswitch's - to what
      // bootstrap already established earlier in this file.
      await restoreKillswitchPosition(killswitchSpec.position);
    }
    const byName = new Map((await cp.listDimensions()).map((d) => [d.dimension, d.position]));
    for (const spec of DIMENSION_SPECS) {
      expect(byName.get(spec.name)).toBe(spec.position);
    }
    // The guard also needs to pass again once positions are back to normal,
    // otherwise this test would have "fixed" the drift by making bootstrap
    // itself permanently unable to run against this workspace.
    await expect(bootstrap(cp)).resolves.not.toThrow();
  });
});
