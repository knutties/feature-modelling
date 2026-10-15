import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/entities.js';
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

let cp: ControlPlane;
let store: EntityStore;
let provisioner: Provisioner;

/** A read as the application would do it, without the kill switch engaged. */
const read = (path: string[]) =>
  cp.resolve({ ...pathCondition(path), killswitch: false });

function pathCondition(path: string[]): Record<string, string> {
  const levels = ['org', 'merchant', 'profile'];
  return Object.fromEntries(path.map((id, i) => [levels[i]!, id]));
}

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await bootstrap(cp);
});

beforeEach(async () => {
  await deleteAllContexts(cp);
  await bootstrap(cp);
  store = new EntityStore(join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json'));
  provisioner = new Provisioner(cp, store);
});

describe('copy materialization', () => {
  it('freezes both copied features for a new org, from the workspace default', async () => {
    const result = await provisioner.createEntity({ path: ['acme'], name: 'Acme' });

    expect(result.copied.map((c) => c.key).sort()).toEqual([THEME, BUDGET].sort());
    expect(result.copied.find((c) => c.key === BUDGET)?.value).toBe(3);
    expect(result.copied.find((c) => c.key === THEME)?.value).toBe('classic');

    const context = await cp.getContext({ org: 'acme' });
    expect(Object.keys(context!.override).sort()).toEqual([THEME, BUDGET].sort());
  });

  it('writes nothing for inherited features', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    const context = await cp.getContext({ org: 'acme' });
    expect(context!.override).not.toHaveProperty(ROLLOUT);
    expect(context!.override).not.toHaveProperty(RETRIES);
  });

  it('copies only the every-level feature at profile, and reports the skip', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    const result = await provisioner.createEntity({ path: ['acme', 'm1', 'p1'], name: 'P1' });

    expect(result.copied.map((c) => c.key)).toEqual([BUDGET]);
    expect(result.skipped.map((s) => s.key)).toContain(THEME);

    const context = await cp.getContext({ org: 'acme', merchant: 'm1', profile: 'p1' });
    expect(Object.keys(context!.override)).toEqual([BUDGET]);
  });

  it('copies the parent value, not the workspace default', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await cp.putContext({ org: 'acme' }, { [BUDGET]: 7 }, 'operator edit');
    const result = await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    expect(result.copied.find((c) => c.key === BUDGET)?.value).toBe(7);
  });
});

describe('the behaviors the model claims', () => {
  beforeEach(async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    await provisioner.createEntity({ path: ['acme', 'm1', 'p1'], name: 'P1' });
  });

  it('moves inherited features for every descendant when the org changes', async () => {
    await cp.putContext({ org: 'acme' }, { [ROLLOUT]: 'shadow', [RETRIES]: false }, 'org edit');

    for (const path of [['acme'], ['acme', 'm1'], ['acme', 'm1', 'p1']]) {
      const config = await read(path);
      expect(config[ROLLOUT]).toBe('shadow');
      expect(config[RETRIES]).toBe(false);
    }
  });

  it('moves no copied feature when the org changes', async () => {
    await cp.putContext({ org: 'acme' }, { [BUDGET]: 9, [THEME]: 'neo' }, 'org edit');

    const merchant = await read(['acme', 'm1']);
    expect(merchant[BUDGET]).toBe(3);
    expect(merchant[THEME]).toBe('classic');
  });

  /**
   * The boundary, demonstrated: editing a merchant reaches its profiles for the
   * till-merchant feature (they inherit the merchant's copy) but not for the
   * every-level feature (they own theirs).
   */
  it('reaches profiles for a till-merchant copy but not an every-level copy', async () => {
    await cp.putContext(
      { org: 'acme', merchant: 'm1' }, { [BUDGET]: 8, [THEME]: 'minimal' }, 'merchant edit',
    );

    const profile = await read(['acme', 'm1', 'p1']);
    expect(profile[THEME]).toBe('minimal');
    expect(profile[BUDGET]).toBe(3);
  });

  it('leaves a sibling with no override on the parent value', async () => {
    await cp.putContext({ org: 'acme' }, { [ROLLOUT]: 'primary' }, 'org edit');
    const sibling = await read(['acme', 'm2']);
    expect(sibling[ROLLOUT]).toBe('primary');
  });

  it('does not move an existing org when the workspace default changes', async () => {
    await cp.putDefaultConfig(
      BUDGET, 1, { type: 'integer', minimum: 0, maximum: 10 }, 'platform change',
    );
    expect((await read(['acme']))[BUDGET]).toBe(3);
  });
});

describe('rejected creations', () => {
  // Review Focus 3
  it('rejects an entity whose parent does not exist, writing nothing', async () => {
    await expect(
      provisioner.createEntity({ path: ['ghost', 'm1'], name: 'M1' }),
    ).rejects.toThrow(/parent/i);
    expect(await cp.getContext({ org: 'ghost', merchant: 'm1' })).toBeNull();
    expect(store.exists(['ghost', 'm1'])).toBe(false);
  });

  // Review Focus 2 - the dangerous one: CreateContext merges, so without this
  // guard a duplicate create would overwrite the existing entity's frozen copies.
  it('rejects a duplicate entity without touching its existing copies', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await cp.putContext({ org: 'acme' }, { [BUDGET]: 7 }, 'operator edit');

    await expect(
      provisioner.createEntity({ path: ['acme'], name: 'Acme Again' }),
    ).rejects.toThrow(/exists/i);

    expect((await cp.getContext({ org: 'acme' }))!.override[BUDGET]).toBe(7);
  });

  // Review Focus 1
  it('rejects an id carrying a separator or a dot before writing anything', async () => {
    await expect(
      provisioner.createEntity({ path: ['ac~me'], name: 'Bad' }),
    ).rejects.toThrow(/~/);
    await expect(
      provisioner.createEntity({ path: ['ac.me'], name: 'Bad' }),
    ).rejects.toThrow();
    expect(store.all()).toEqual([]);
  });

  it('rejects a path deeper than the hierarchy', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    await provisioner.createEntity({ path: ['acme', 'm1', 'p1'], name: 'P1' });
    await expect(
      provisioner.createEntity({ path: ['acme', 'm1', 'p1', 'x'], name: 'X' }),
    ).rejects.toThrow();
  });
});

describe('retry', () => {
  it('is idempotent - re-running leaves the same copies', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    const before = await cp.getContext({ org: 'acme' });
    store.setState(['acme'], 'provisioning_failed');

    await provisioner.retry(['acme']);

    const after = await cp.getContext({ org: 'acme' });
    expect(after!.override).toEqual(before!.override);
    expect(store.get(['acme'])?.provisioningState).toBe('ok');
  });
});
