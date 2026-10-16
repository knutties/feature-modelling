import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/entities.js';

function freshStore(): EntityStore {
  return new EntityStore(join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json'));
}

let store: EntityStore;
beforeEach(() => {
  store = freshStore();
});

describe('EntityStore', () => {
  it('starts empty', () => {
    expect(store.all()).toEqual([]);
    expect(store.tree()).toEqual([]);
  });

  it('adds an org and finds it by path', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    expect(store.exists(['acme'])).toBe(true);
    expect(store.get(['acme'])?.level).toBe('org');
    expect(store.get(['acme'])?.provisioningState).toBe('ok');
  });

  it('lists children of a path, not grandchildren', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.add({ id: 'm1', name: 'M1', path: ['acme', 'm1'] });
    store.add({ id: 'm2', name: 'M2', path: ['acme', 'm2'] });
    store.add({ id: 'p1', name: 'P1', path: ['acme', 'm1', 'p1'] });

    expect(store.children(['acme']).map((e) => e.id).sort()).toEqual(['m1', 'm2']);
    expect(store.children(['acme', 'm1']).map((e) => e.id)).toEqual(['p1']);
    expect(store.children(['acme', 'm2'])).toEqual([]);
  });

  it('lists roots as the children of the empty path', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.add({ id: 'globex', name: 'Globex', path: ['globex'] });
    expect(store.children([]).map((e) => e.id).sort()).toEqual(['acme', 'globex']);
  });

  it('records a provisioning failure and lets it be cleared', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.setState(['acme'], 'provisioning_failed');
    expect(store.get(['acme'])?.provisioningState).toBe('provisioning_failed');
    store.setState(['acme'], 'ok');
    expect(store.get(['acme'])?.provisioningState).toBe('ok');
  });

  it('persists across instances sharing a file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json');
    const first = new EntityStore(path);
    first.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    expect(new EntityStore(path).get(['acme'])?.name).toBe('Acme');
  });

  it('builds a nested tree', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.add({ id: 'm1', name: 'M1', path: ['acme', 'm1'] });
    store.add({ id: 'p1', name: 'P1', path: ['acme', 'm1', 'p1'] });

    const tree = store.tree();
    expect(tree).toHaveLength(1);
    expect(tree[0]!.entity.id).toBe('acme');
    expect(tree[0]!.children[0]!.entity.id).toBe('m1');
    expect(tree[0]!.children[0]!.children[0]!.entity.id).toBe('p1');
    expect(tree[0]!.children[0]!.children[0]!.children).toEqual([]);
  });

  // Review Focus 1, at the store boundary.
  it('rejects an id carrying a separator or dot', () => {
    expect(() => store.add({ id: 'ac~me', name: 'x', path: ['ac~me'] })).toThrow();
    expect(() => store.add({ id: 'ac.me', name: 'x', path: ['ac.me'] })).toThrow();
  });
});
