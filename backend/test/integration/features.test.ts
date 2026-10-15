import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/entities.js';
import { FeatureService } from '../../src/features.js';
import { Provisioner } from '../../src/provisioner.js';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { bootstrap } from '../../src/superposition/schema.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

const ROLLOUT = 'internal.inherited.decision_engine_rollout';
const BUDGET = 'internal.copied.connector_retry_budget';
const RETRIES = 'external.inherited.payment_retries_enabled';
const THEME = 'external.copied_till_merchant.checkout_theme';

const ACME = ['acme'];
const M1 = ['acme', 'm1'];
const P1 = ['acme', 'm1', 'p1'];

let cp: ControlPlane;
let features: FeatureService;

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await bootstrap(cp);
});

beforeEach(async () => {
  await deleteAllContexts(cp);
  await bootstrap(cp);
  const store = new EntityStore(join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json'));
  const provisioner = new Provisioner(cp, store);
  await provisioner.createEntity({ path: ACME, name: 'Acme' });
  await provisioner.createEntity({ path: M1, name: 'M1' });
  await provisioner.createEntity({ path: P1, name: 'P1' });
  features = new FeatureService(cp);
});

describe('viewFor', () => {
  it('reports provenance per feature', async () => {
    const view = await features.viewFor(M1, 'operator');
    const byKey = new Map(view.map((v) => [v.feature.key, v]));

    expect(byKey.get(ROLLOUT)!.provenance.kind).toBe('default');
    expect(byKey.get(BUDGET)!.provenance.kind).toBe('own');
    expect(byKey.get(THEME)!.provenance.kind).toBe('own');
  });

  it('calls a profile value inherited for a till-merchant feature', async () => {
    const byKey = new Map((await features.viewFor(P1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(THEME)!.provenance).toEqual({ kind: 'inherited', fromPath: M1 });
    expect(byKey.get(THEME)!.provenanceLabel).toBe('inherited from acme/m1');
    expect(byKey.get(BUDGET)!.provenance.kind).toBe('own');
  });

  it('distinguishes own from inherited although the values are equal', async () => {
    const byKey = new Map((await features.viewFor(P1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(THEME)!.value).toBe('classic');
    expect(byKey.get(BUDGET)!.value).toBe(3);
    expect(byKey.get(THEME)!.provenance.kind).not.toBe(byKey.get(BUDGET)!.provenance.kind);
  });

  it('hides internal features from a customer entirely', async () => {
    const view = await features.viewFor(M1, 'customer');
    expect(view.map((v) => v.feature.key).sort()).toEqual([THEME, RETRIES].sort());
    expect(view.every((v) => v.feature.manageability === 'external')).toBe(true);
  });
});

describe('setValue', () => {
  it('sets an own override and reports it as own', async () => {
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    const byKey = new Map((await features.viewFor(M1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(ROLLOUT)!.value).toBe('shadow');
    expect(byKey.get(ROLLOUT)!.provenance.kind).toBe('own');
  });

  it('leaves the other keys in the context alone', async () => {
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    const context = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(context!.override[BUDGET]).toBe(3);
    expect(context!.override[THEME]).toBe('classic');
    expect(context!.override[ROLLOUT]).toBe('shadow');
  });

  it('refuses a customer setting an internal feature', async () => {
    await expect(features.setValue(M1, ROLLOUT, 'shadow', 'customer'))
      .rejects.toThrow(/may not manage/);
    const context = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(context!.override).not.toHaveProperty(ROLLOUT);
  });

  /**
   * Review Focus 5: Superposition validates against the key's schema. Surface
   * its message rather than a generic one, and write nothing.
   */
  it('surfaces a schema violation and writes nothing', async () => {
    await expect(features.setValue(M1, BUDGET, 99, 'operator')).rejects.toThrow();
    expect((await cp.getContext({ org: 'acme', merchant: 'm1' }))!.override[BUDGET]).toBe(3);
  });

  it('rejects an off-enum value', async () => {
    await expect(features.setValue(M1, THEME, 'neon', 'operator')).rejects.toThrow();
    expect((await cp.getContext({ org: 'acme', merchant: 'm1' }))!.override[THEME]).toBe('classic');
  });

  it('rejects a key that is not in the catalog', async () => {
    await expect(features.setValue(M1, 'external.inherited.nope', true, 'operator'))
      .rejects.toThrow(/not a known feature/);
  });
});

describe('revert', () => {
  it('removes one key and preserves the rest of the context', async () => {
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    await features.revert(M1, ROLLOUT, 'operator');

    const context = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(context!.override).not.toHaveProperty(ROLLOUT);
    expect(context!.override[BUDGET]).toBe(3);
    expect(context!.override[THEME]).toBe('classic');
  });

  it('falls back to the inherited value after reverting', async () => {
    await features.setValue(ACME, ROLLOUT, 'primary', 'operator');
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    await features.revert(M1, ROLLOUT, 'operator');

    const byKey = new Map((await features.viewFor(M1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(ROLLOUT)!.value).toBe('primary');
    expect(byKey.get(ROLLOUT)!.provenance).toEqual({ kind: 'inherited', fromPath: ACME });
  });

  it('deletes the context when the reverted key was its only override', async () => {
    await features.setValue(P1, ROLLOUT, 'shadow', 'operator');
    await features.revert(P1, BUDGET, 'operator');
    await features.revert(P1, ROLLOUT, 'operator');
    expect(await cp.getContext({ org: 'acme', merchant: 'm1', profile: 'p1' })).toBeNull();
  });

  it('refuses a customer reverting an internal feature', async () => {
    await expect(features.revert(M1, BUDGET, 'customer')).rejects.toThrow(/may not manage/);
  });
});

describe('cohort specialization', () => {
  it('beats the profile value for a customer in the cohort', async () => {
    await features.setValue(P1, THEME, 'classic', 'operator');
    await features.setCohortValue(P1, 'gold', THEME, 'minimal', 'operator');

    const gold = await features.resolveAs(P1, 'cust_001', 'operator');
    expect(gold.config[THEME]).toBe('minimal');

    const ordinary = await features.resolveAs(P1, 'cust_777', 'operator');
    expect(ordinary.config[THEME]).toBe('classic');
  });

  it('works the same for a copied feature, since it is an explicit override', async () => {
    await features.setCohortValue(P1, 'high_risk', RETRIES, false, 'operator');
    const risky = await features.resolveAs(P1, 'cust_009', 'operator');
    expect(risky.config[RETRIES]).toBe(false);
    expect((await features.resolveAs(P1, 'cust_001', 'operator')).config[RETRIES]).toBe(true);
  });

  it('rejects a cohort name that is not in the dimension enum', async () => {
    await expect(features.setCohortValue(P1, 'platinum', THEME, 'neo', 'operator'))
      .rejects.toThrow(/platinum/);
  });

  it('refuses a customer specializing an internal feature', async () => {
    await expect(features.setCohortValue(P1, 'gold', BUDGET, 1, 'customer'))
      .rejects.toThrow(/may not manage/);
  });
});

describe('kill switch', () => {
  it('overrides every entity while leaving their overrides on disk', async () => {
    await features.setValue(ACME, RETRIES, true, 'operator');
    await features.setValue(M1, RETRIES, true, 'operator');
    await features.engageKillSwitch(RETRIES, false, 'operator');

    for (const path of [ACME, M1, P1]) {
      const resolved = await features.resolveAs(path, 'cust_777', 'operator', { killswitch: true });
      expect(resolved.config[RETRIES]).toBe(false);
    }

    expect((await cp.getContext({ org: 'acme' }))!.override[RETRIES]).toBe(true);
  });

  it('beats a cohort override too', async () => {
    await features.setCohortValue(P1, 'gold', THEME, 'minimal', 'operator');
    await features.engageKillSwitch(THEME, 'classic', 'operator');

    const gold = await features.resolveAs(P1, 'cust_001', 'operator', { killswitch: true });
    expect(gold.config[THEME]).toBe('classic');
  });

  it('restores the prior resolution exactly when disengaged', async () => {
    await features.setValue(M1, RETRIES, false, 'operator');
    const before = await features.resolveAs(M1, 'cust_777', 'operator');

    await features.engageKillSwitch(RETRIES, true, 'operator');
    await features.disengageKillSwitch(RETRIES, 'operator');

    const after = await features.resolveAs(M1, 'cust_777', 'operator');
    expect(after.config).toEqual(before.config);
  });

  it('is operator-only', async () => {
    await expect(features.engageKillSwitch(THEME, 'classic', 'customer'))
      .rejects.toThrow(/operator/);
    await expect(features.disengageKillSwitch(THEME, 'customer'))
      .rejects.toThrow(/operator/);
  });

  it('validates the emergency value against the schema', async () => {
    await expect(features.engageKillSwitch(BUDGET, 99, 'operator')).rejects.toThrow();
  });
});

describe('resolveAs', () => {
  it('never returns an internal key for a customer', async () => {
    const resolved = await features.resolveAs(M1, 'cust_001', 'customer');
    expect(Object.keys(resolved.config).some((k) => k.startsWith('internal.'))).toBe(false);
    expect(resolved.config[THEME]).toBe('classic');
  });

  it('reports the cohort it computed for the customer', async () => {
    expect((await features.resolveAs(P1, 'cust_001', 'operator')).cohort).toBe('gold');
    expect((await features.resolveAs(P1, 'cust_777', 'operator')).cohort).toBe('otherwise');
  });
});

describe('explain', () => {
  it('returns the cascade as an ordered timeline', async () => {
    await features.setValue(ACME, ROLLOUT, 'shadow', 'operator');
    await features.setValue(M1, ROLLOUT, 'primary', 'operator');

    const timeline = await features.explain(M1, ROLLOUT);
    expect(timeline.map((t) => t.value_after)).toEqual(['shadow', 'primary']);
  });
});
