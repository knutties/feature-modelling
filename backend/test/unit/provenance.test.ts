import { describe, expect, it } from 'vitest';
import {
  type TimelineItem, describeProvenance, provenanceOf,
} from '../../src/model/provenance.js';

function step(condition: Record<string, unknown>, before: unknown, after: unknown): TimelineItem {
  return {
    context_id: `ctx-${JSON.stringify(condition)}`,
    condition,
    override_id: 'ovr',
    value_before: before,
    value_after: after,
  };
}

const profile = ['acme', 'm1', 'p1'];

describe('provenanceOf', () => {
  it('reports the platform default for an empty timeline', () => {
    expect(provenanceOf([], profile)).toEqual({ kind: 'default' });
  });

  it('reports own when the last context is the entity itself', () => {
    const timeline = [
      step({ org: 'acme' }, 'classic', 'neo'),
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'neo', 'minimal'),
    ];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'own' });
  });

  it('reports the ancestor when the last context is a proper prefix', () => {
    const timeline = [step({ org: 'acme', merchant: 'm1' }, 'classic', 'neo')];
    expect(provenanceOf(timeline, profile)).toEqual({
      kind: 'inherited', fromPath: ['acme', 'm1'],
    });
  });

  it('reports the org when only the org has a value', () => {
    const timeline = [step({ org: 'acme' }, 'classic', 'neo')];
    expect(provenanceOf(timeline, profile)).toEqual({
      kind: 'inherited', fromPath: ['acme'],
    });
  });

  /**
   * Review-adjacent: the case that rules out inferring provenance by comparing
   * an entity's value to its ancestor's. Right after a copy the two values are
   * EQUAL, so only the condition can distinguish own from inherited.
   */
  it('distinguishes own from inherited when the values are equal', () => {
    const inherited = [step({ org: 'acme', merchant: 'm1' }, 'classic', 'classic')];
    const own = [
      step({ org: 'acme', merchant: 'm1' }, 'classic', 'classic'),
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'classic', 'classic'),
    ];
    expect(provenanceOf(inherited, profile).kind).toBe('inherited');
    expect(provenanceOf(own, profile).kind).toBe('own');
  });

  it('reports a cohort override', () => {
    const timeline = [
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'classic', 'neo'),
      step(
        { org: 'acme', merchant: 'm1', profile: 'p1', customer_cohort: 'gold' },
        'neo', 'minimal',
      ),
    ];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'cohort', cohort: 'gold' });
  });

  it('reports the kill switch, whatever else matched', () => {
    const timeline = [
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'classic', 'neo'),
      step({ killswitch: true }, 'neo', 'classic'),
    ];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'killswitch' });
  });

  it('prefers the kill switch over a cohort in the same condition', () => {
    const timeline = [step({ customer_cohort: 'gold', killswitch: true }, 'a', 'b')];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'killswitch' });
  });
});

describe('describeProvenance', () => {
  it('renders each kind for the UI', () => {
    expect(describeProvenance({ kind: 'default' })).toBe('platform default');
    expect(describeProvenance({ kind: 'own' })).toBe('own');
    expect(describeProvenance({ kind: 'inherited', fromPath: ['acme', 'm1'] }))
      .toBe('inherited from acme/m1');
    expect(describeProvenance({ kind: 'cohort', cohort: 'gold' }))
      .toBe('cohort gold');
    expect(describeProvenance({ kind: 'killswitch' })).toBe('kill switch engaged');
  });
});
