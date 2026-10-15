import { describe, expect, it } from 'vitest';
import { DIMENSION_POSITIONS, weightOf } from '../../src/model/dimensions.js';

describe('dimension positions', () => {
  it('pins the positions the cascade depends on', () => {
    expect(DIMENSION_POSITIONS).toEqual({
      org: 1, merchant: 2, profile: 3, customer_cohort: 4, customer_id: 5, killswitch: 6,
    });
  });

  it('keeps a cohort at or below its parent dimension', () => {
    expect(DIMENSION_POSITIONS.customer_cohort).toBeLessThanOrEqual(
      DIMENSION_POSITIONS.customer_id,
    );
  });
});

describe('priority arithmetic', () => {
  it('weights a context as the sum of 2^position', () => {
    expect(weightOf({ org: 'acme' })).toBe(2);
    expect(weightOf({ org: 'acme', merchant: 'm1' })).toBe(6);
    expect(weightOf({ org: 'acme', merchant: 'm1', profile: 'p1' })).toBe(14);
  });

  // These three orderings are the model. If any fails, inheritance is broken.
  it('makes a deeper entity outrank a shallower one', () => {
    expect(weightOf({ org: 'a', merchant: 'm', profile: 'p' }))
      .toBeGreaterThan(weightOf({ org: 'a', merchant: 'm' }));
    expect(weightOf({ org: 'a', merchant: 'm' })).toBeGreaterThan(weightOf({ org: 'a' }));
  });

  it('makes a cohort outrank any entity path', () => {
    expect(weightOf({ org: 'a', merchant: 'm', profile: 'p', customer_cohort: 'gold' }))
      .toBe(30);
    expect(weightOf({ org: 'a', merchant: 'm', profile: 'p', customer_cohort: 'gold' }))
      .toBeGreaterThan(weightOf({ org: 'a', merchant: 'm', profile: 'p' }));
  });

  it('makes the kill switch outrank every other dimension combined', () => {
    const everythingElse = weightOf({
      org: 'a', merchant: 'm', profile: 'p', customer_cohort: 'gold', customer_id: 'c1',
    });
    expect(everythingElse).toBe(62);
    expect(weightOf({ killswitch: true })).toBe(64);
    expect(weightOf({ killswitch: true })).toBeGreaterThan(everythingElse);
  });

  it('ignores keys that are not dimensions', () => {
    expect(weightOf({ org: 'a', nonsense: 'x' })).toBe(2);
  });
});
