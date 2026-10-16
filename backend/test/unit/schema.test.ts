import { describe, expect, it } from 'vitest';
import { COHORTS, COHORT_PARENT, DIMENSION_SPECS } from '../../src/superposition/schema.js';

const cohort = DIMENSION_SPECS.find((spec) => spec.name === 'customer_cohort')!;

/**
 * A local cohort states its parent dimension twice: once in the
 * `LOCAL_COHORT` declaration Superposition stores, and once inside each
 * membership rule's JSONLogic, which reads `{ var: <parent> }`. Nothing on the
 * server cross-checks them - a cohort whose JSONLogic reads a dimension that
 * is not its declared parent simply never matches - so renaming one and not
 * the other would break cohort specialization silently. Both now come from
 * COHORT_PARENT; this asserts it.
 */
describe('customer_cohort dimension', () => {
  it('reads the same dimension in its JSONLogic that it declares as its parent', () => {
    const definitions = cohort.schema['definitions'] as Record<string, unknown>;
    expect(Object.keys(definitions).sort()).toEqual(Object.keys(COHORTS).sort());

    for (const [name, rule] of Object.entries(definitions)) {
      const [variable] = (rule as { in: [{ var: string }, string[]] }).in;
      expect(variable, `cohort ${name}`).toEqual({ var: cohort.localCohortOf });
      expect(variable.var, `cohort ${name}`).toBe(COHORT_PARENT);
    }
  });

  it('declares a parent dimension that exists in the spec list', () => {
    expect(cohort.localCohortOf).toBe(COHORT_PARENT);
    expect(DIMENSION_SPECS.map((spec) => spec.name)).toContain(COHORT_PARENT);
  });

  it('keeps every cohort membership list in the enum, plus the mandatory fallback', () => {
    expect(cohort.schema['enum']).toEqual([...Object.keys(COHORTS), 'otherwise']);
  });
});
