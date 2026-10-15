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
      await moveDimension('killswitch', killswitchSpec.position);
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
