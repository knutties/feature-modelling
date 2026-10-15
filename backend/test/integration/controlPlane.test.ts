import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

const KEY = 'external.inherited.cp_probe_value';
let cp: ControlPlane;

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await deleteAllContexts(cp);
  await cp.createDimension({ name: 'org', position: 1, schema: { type: 'string' }, description: 'org' });
  await cp.createDimension({ name: 'merchant', position: 2, schema: { type: 'string' }, description: 'merchant' });
  await cp.putDefaultConfig(KEY, 'alpha', { type: 'string' }, 'control plane probe');
});

afterAll(async () => {
  if (cp) await deleteAllContexts(cp);
});

describe('default configs', () => {
  it('lists the key it just wrote', async () => {
    const rows = await cp.listDefaultConfigs();
    expect(rows.map((r) => r.key)).toContain(KEY);
    expect(rows.find((r) => r.key === KEY)?.value).toBe('alpha');
  });

  it('is idempotent - a second write updates rather than failing', async () => {
    await cp.putDefaultConfig(KEY, 'beta', { type: 'string' }, 'control plane probe');
    const rows = await cp.listDefaultConfigs();
    expect(rows.find((r) => r.key === KEY)?.value).toBe('beta');
    await cp.putDefaultConfig(KEY, 'alpha', { type: 'string' }, 'control plane probe');
  });
});

describe('dimensions', () => {
  it('is idempotent on create', async () => {
    await cp.createDimension({ name: 'org', position: 1, schema: { type: 'string' }, description: 'org' });
    const names = (await cp.listDimensions()).map((d) => d.dimension);
    expect(names).toContain('org');
    expect(names.filter((n) => n === 'org')).toHaveLength(1);
  });
});

describe('contexts', () => {
  it('returns null for a condition with no context', async () => {
    expect(await cp.getContext({ org: 'ghost' })).toBeNull();
  });

  it('creates a context and reads it back', async () => {
    await cp.putContext({ org: 'acme' }, { [KEY]: 'org-value' }, 'test');
    const row = await cp.getContext({ org: 'acme' });
    expect(row).not.toBeNull();
    expect(row!.override[KEY]).toBe('org-value');
  });

  // Spec correction 1: CreateContext merges, so set-a-key is one call.
  it('merges a second key into an existing context rather than replacing it', async () => {
    await cp.putDefaultConfig('external.inherited.cp_probe_other', 'x', { type: 'string' }, 'probe');
    await cp.putContext({ org: 'acme' }, { 'external.inherited.cp_probe_other': 'y' }, 'test');
    const row = await cp.getContext({ org: 'acme' });
    expect(row!.override[KEY]).toBe('org-value');
    expect(row!.override['external.inherited.cp_probe_other']).toBe('y');
  });

  it('overwrites the value of a key already in the context', async () => {
    await cp.putContext({ org: 'acme' }, { [KEY]: 'changed' }, 'test');
    expect((await cp.getContext({ org: 'acme' }))!.override[KEY]).toBe('changed');
  });

  it('shrinks an override set via replaceContextOverrides', async () => {
    await cp.replaceContextOverrides({ org: 'acme' }, { [KEY]: 'only' }, 'test');
    const row = await cp.getContext({ org: 'acme' });
    expect(Object.keys(row!.override)).toEqual([KEY]);
    expect(row!.override[KEY]).toBe('only');
  });

  it('weights a deeper context above a shallower one', async () => {
    await cp.putContext({ org: 'acme', merchant: 'm1' }, { [KEY]: 'merchant-value' }, 'test');
    const org = await cp.getContext({ org: 'acme' });
    const merchant = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(Number(merchant!.weight)).toBeGreaterThan(Number(org!.weight));
  });

  it('records whether REPLACE shrinks an override set in one action', async () => {
    await cp.putContext({ org: 'replaceprobe' }, { [KEY]: 'a' }, 'test');
    await cp.putDefaultConfig('external.inherited.cp_probe_second', 's', { type: 'string' }, 'probe');
    await cp.putContext({ org: 'replaceprobe' }, { 'external.inherited.cp_probe_second': 's' }, 'test');

    const before = await cp.getContext({ org: 'replaceprobe' });
    expect(Object.keys(before!.override)).toHaveLength(2);

    await cp.replaceContextOverrides({ org: 'replaceprobe' }, { [KEY]: 'a' }, 'test');
    const after = await cp.getContext({ org: 'replaceprobe' });
    expect(Object.keys(after!.override)).toEqual([KEY]);
  });
});

describe('resolve and explain', () => {
  it('resolves the deepest matching context', async () => {
    const config = await cp.resolve({ org: 'acme', merchant: 'm1' });
    expect(config[KEY]).toBe('merchant-value');
  });

  it('falls back to the org value for a sibling with no context', async () => {
    const config = await cp.resolve({ org: 'acme', merchant: 'm2' });
    expect(config[KEY]).toBe('only');
  });

  it('filters by prefix so excluded keys never arrive', async () => {
    await cp.putDefaultConfig('internal.inherited.cp_probe_secret', 'hidden', { type: 'string' }, 'probe');
    const config = await cp.resolve({ org: 'acme' }, { prefix: ['external.'] });
    expect(Object.keys(config).some((k) => k.startsWith('internal.'))).toBe(false);
    expect(config[KEY]).toBe('only');
  });

  it('explains the cascade as an ordered timeline', async () => {
    const timeline = await cp.explain(KEY, { org: 'acme', merchant: 'm1' });
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0]!.condition).toEqual({ org: 'acme' });
    expect(timeline[timeline.length - 1]!.condition).toEqual({ org: 'acme', merchant: 'm1' });
    expect(timeline[timeline.length - 1]!.value_after).toBe('merchant-value');
  });

  it('returns an empty timeline when only the default applies', async () => {
    expect(await cp.explain(KEY, { org: 'untouched' })).toEqual([]);
  });
});
