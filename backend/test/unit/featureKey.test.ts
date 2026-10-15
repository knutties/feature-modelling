import { describe, expect, it } from 'vitest';
import {
  FeatureKeyError, formatFeatureKey, parseFeatureKey, tryParseFeatureKey,
} from '../../src/model/featureKey.js';

describe('parseFeatureKey', () => {
  it('parses an inherited internal key', () => {
    expect(parseFeatureKey('internal.inherited.decision_engine_rollout')).toEqual({
      key: 'internal.inherited.decision_engine_rollout',
      manageability: 'internal',
      propagation: { kind: 'inherited' },
      name: 'decision_engine_rollout',
    });
  });

  it('expands bare `copied` to the deepest level', () => {
    expect(parseFeatureKey('internal.copied.connector_retry_budget').propagation)
      .toEqual({ kind: 'copied', till: 'profile' });
  });

  it('parses an explicit copy boundary', () => {
    expect(parseFeatureKey('external.copied_till_merchant.checkout_theme').propagation)
      .toEqual({ kind: 'copied', till: 'merchant' });
    expect(parseFeatureKey('external.copied_till_org.x').propagation)
      .toEqual({ kind: 'copied', till: 'org' });
  });

  it('keeps dots inside the name', () => {
    const parsed = parseFeatureKey('external.inherited.checkout.theme.v2');
    expect(parsed.name).toBe('checkout.theme.v2');
    expect(parsed.manageability).toBe('external');
  });

  it('rejects an unknown manageability', () => {
    expect(() => parseFeatureKey('wibble.inherited.x')).toThrow(/manageability/);
  });

  it('rejects an unknown propagation', () => {
    expect(() => parseFeatureKey('internal.wibble.x')).toThrow(/propagation/);
  });

  it('rejects a copy boundary naming a level that does not exist', () => {
    expect(() => parseFeatureKey('internal.copied_till_galaxy.x')).toThrow(/galaxy/);
  });

  it('rejects a key with too few segments', () => {
    expect(() => parseFeatureKey('internal.inherited')).toThrow(/segments/);
    expect(() => parseFeatureKey('solo')).toThrow(FeatureKeyError);
  });

  it('rejects keys Superposition itself would refuse', () => {
    expect(() => parseFeatureKey('internal.inherited.has@at')).toThrow(/legal/);
    expect(() => parseFeatureKey('.internal.inherited.x')).toThrow(/legal/);
    expect(() => parseFeatureKey('internal.inherited.x.')).toThrow(/legal/);
  });
});

describe('tryParseFeatureKey', () => {
  it('returns null instead of throwing', () => {
    expect(tryParseFeatureKey('not_a_feature')).toBeNull();
    expect(tryParseFeatureKey('external.inherited.ok')?.name).toBe('ok');
  });
});

describe('formatFeatureKey', () => {
  it('round-trips every propagation form', () => {
    for (const key of [
      'internal.inherited.a',
      'internal.copied.b',
      'external.copied_till_merchant.c',
      'external.copied_till_org.d',
    ]) {
      const parsed = parseFeatureKey(key);
      expect(formatFeatureKey(parsed.manageability, parsed.propagation, parsed.name))
        .toBe(key);
    }
  });
});
