import { describe, expect, it } from 'vitest';
import {
  HierarchyError, LEVELS, PATH_SEPARATOR, ancestorPaths, conditionToPath,
  decodePath, encodePath, levelIndex, levelOf, parentPath, pathToCondition,
  validateEntityId,
} from '../../src/model/hierarchy.js';

describe('levels', () => {
  it('orders org shallowest to profile deepest', () => {
    expect(LEVELS).toEqual(['org', 'merchant', 'profile']);
    expect(levelIndex('org')).toBe(0);
    expect(levelIndex('profile')).toBe(2);
  });

  it('derives the level from the path depth', () => {
    expect(levelOf(['acme'])).toBe('org');
    expect(levelOf(['acme', 'm1'])).toBe('merchant');
    expect(levelOf(['acme', 'm1', 'p1'])).toBe('profile');
  });

  it('rejects a path with no level', () => {
    expect(() => levelOf([])).toThrow(HierarchyError);
    expect(() => levelOf(['a', 'b', 'c', 'd'])).toThrow(HierarchyError);
  });
});

describe('paths', () => {
  it('gives an org an empty parent', () => {
    expect(parentPath(['acme'])).toEqual([]);
    expect(parentPath(['acme', 'm1'])).toEqual(['acme']);
    expect(parentPath(['acme', 'm1', 'p1'])).toEqual(['acme', 'm1']);
  });

  it('lists proper ancestors shallowest first', () => {
    expect(ancestorPaths(['acme', 'm1', 'p1'])).toEqual([['acme'], ['acme', 'm1']]);
    expect(ancestorPaths(['acme'])).toEqual([]);
  });

  it('round-trips a path through a condition', () => {
    expect(pathToCondition(['acme', 'm1'])).toEqual({ org: 'acme', merchant: 'm1' });
    expect(conditionToPath({ org: 'acme', merchant: 'm1' })).toEqual(['acme', 'm1']);
  });

  it('stops reading a condition at the first missing level', () => {
    expect(conditionToPath({ org: 'acme', profile: 'p1' })).toEqual(['acme']);
    expect(conditionToPath({ killswitch: true })).toEqual([]);
  });

  it('round-trips a path through its URL form', () => {
    expect(encodePath(['acme', 'm1', 'p1'])).toBe('acme~m1~p1');
    expect(decodePath('acme~m1~p1')).toEqual(['acme', 'm1', 'p1']);
    expect(decodePath('acme')).toEqual(['acme']);
  });
});

describe('entity id validation', () => {
  it('accepts alphanumerics, dash and underscore', () => {
    for (const id of ['acme', 'm-1', 'p_1', 'A9']) {
      expect(() => validateEntityId(id)).not.toThrow();
    }
  });

  // Review Focus 1: a separator or dot inside an id would corrupt both the URL
  // form and the Superposition condition.
  it('rejects an id containing the path separator', () => {
    expect(() => validateEntityId('ac~me')).toThrow(/~/);
  });

  it('rejects an id containing a dot', () => {
    expect(() => validateEntityId('ac.me')).toThrow(HierarchyError);
  });

  it('rejects an empty id', () => {
    expect(() => validateEntityId('')).toThrow(HierarchyError);
  });

  it('rejects a separator-bearing id when decoding a URL path', () => {
    expect(() => decodePath('acme~m.1')).toThrow(HierarchyError);
    expect(() => decodePath('')).toThrow(HierarchyError);
    expect(() => decodePath('a~b~c~d')).toThrow(HierarchyError);
  });

  it('keeps the separator out of the legal id charset', () => {
    expect(() => validateEntityId(PATH_SEPARATOR)).toThrow(HierarchyError);
  });
});
