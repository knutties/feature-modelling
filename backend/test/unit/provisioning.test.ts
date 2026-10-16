import { describe, expect, it } from 'vitest';
import { parseFeatureKey } from '../../src/model/featureKey.js';
import { planCopies, shouldCopy } from '../../src/model/provisioning.js';

const DEMO = [
  'internal.inherited.decision_engine_rollout',
  'internal.copied.connector_retry_budget',
  'external.inherited.payment_retries_enabled',
  'external.copied_till_merchant.checkout_theme',
].map(parseFeatureKey);

const inherited = DEMO[0]!;
const copiedEverywhere = DEMO[1]!;
const copiedTillMerchant = DEMO[3]!;

describe('shouldCopy', () => {
  it('never copies an inherited feature', () => {
    for (const level of ['org', 'merchant', 'profile'] as const) {
      expect(shouldCopy(inherited, level)).toBe(false);
    }
  });

  it('copies a bare-copied feature at every level', () => {
    expect(shouldCopy(copiedEverywhere, 'org')).toBe(true);
    expect(shouldCopy(copiedEverywhere, 'merchant')).toBe(true);
    expect(shouldCopy(copiedEverywhere, 'profile')).toBe(true);
  });

  // The boundary: ownership starts at the top and stops at `till`.
  it('copies down to the boundary and no further', () => {
    expect(shouldCopy(copiedTillMerchant, 'org')).toBe(true);
    expect(shouldCopy(copiedTillMerchant, 'merchant')).toBe(true);
    expect(shouldCopy(copiedTillMerchant, 'profile')).toBe(false);
  });

  it('copies only at the root for a till-org feature', () => {
    const tillOrg = parseFeatureKey('internal.copied_till_org.x');
    expect(shouldCopy(tillOrg, 'org')).toBe(true);
    expect(shouldCopy(tillOrg, 'merchant')).toBe(false);
    expect(shouldCopy(tillOrg, 'profile')).toBe(false);
  });
});

describe('planCopies', () => {
  it('names the parent to copy from, empty for an org', () => {
    expect(planCopies(DEMO, ['acme'])).toEqual([
      { key: 'internal.copied.connector_retry_budget', fromPath: [] },
      { key: 'external.copied_till_merchant.checkout_theme', fromPath: [] },
    ]);
  });

  it('copies both copied features at merchant level', () => {
    expect(planCopies(DEMO, ['acme', 'm1'])).toEqual([
      { key: 'internal.copied.connector_retry_budget', fromPath: ['acme'] },
      { key: 'external.copied_till_merchant.checkout_theme', fromPath: ['acme'] },
    ]);
  });

  // The demo's central contrast, as a fixture.
  it('copies only the every-level feature at profile level', () => {
    expect(planCopies(DEMO, ['acme', 'm1', 'p1'])).toEqual([
      { key: 'internal.copied.connector_retry_budget', fromPath: ['acme', 'm1'] },
    ]);
  });

  it('plans nothing when no feature is copied', () => {
    expect(planCopies([inherited], ['acme', 'm1'])).toEqual([]);
  });
});
