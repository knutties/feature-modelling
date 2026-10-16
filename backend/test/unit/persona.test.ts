import { describe, expect, it } from 'vitest';
import { parseFeatureKey } from '../../src/model/featureKey.js';
import {
  PersonaError, assertCanManage, canManage, parsePersona, resolvePrefixes,
} from '../../src/model/persona.js';

const internalFeature = parseFeatureKey('internal.inherited.decision_engine_rollout');
const externalFeature = parseFeatureKey('external.inherited.payment_retries_enabled');

describe('parsePersona', () => {
  it('defaults to operator when absent', () => {
    expect(parsePersona(undefined)).toBe('operator');
  });

  it('accepts the two personas', () => {
    expect(parsePersona('operator')).toBe('operator');
    expect(parsePersona('customer')).toBe('customer');
  });

  it('rejects anything else rather than silently widening access', () => {
    expect(() => parsePersona('admin')).toThrow(PersonaError);
    expect(() => parsePersona('internal')).toThrow(PersonaError);
  });
});

describe('resolvePrefixes', () => {
  // Pushed into the GetResolvedConfig call so internal keys are never returned,
  // rather than being fetched and filtered out afterwards.
  it('restricts a customer to external keys', () => {
    expect(resolvePrefixes('customer')).toEqual(['external.']);
  });

  it('does not filter for an operator', () => {
    expect(resolvePrefixes('operator')).toBeUndefined();
  });
});

describe('canManage', () => {
  it('lets an operator manage both classes', () => {
    expect(canManage('operator', internalFeature)).toBe(true);
    expect(canManage('operator', externalFeature)).toBe(true);
  });

  it('lets a customer manage only external features', () => {
    expect(canManage('customer', externalFeature)).toBe(true);
    expect(canManage('customer', internalFeature)).toBe(false);
  });

  it('throws with the key named when a customer reaches for an internal feature', () => {
    expect(() => assertCanManage('customer', internalFeature))
      .toThrow(/internal\.inherited\.decision_engine_rollout/);
    expect(() => assertCanManage('operator', internalFeature)).not.toThrow();
  });
});
