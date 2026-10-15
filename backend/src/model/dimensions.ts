/**
 * Dimension positions. Superposition weights a context as the sum of 2^position
 * over the dimensions it names, and the highest weight wins. These values are
 * therefore the model's precedence rules, not configuration:
 *
 *   - deeper entity beats shallower   (14 > 6 > 2)
 *   - a cohort beats any entity path  (30 > 14)
 *   - the kill switch beats all       (64 > 62)
 *
 * Inserting a dimension at a careless position silently breaks inheritance,
 * which is why dimensions.test.ts asserts the arithmetic.
 */
export const DIMENSION_POSITIONS = {
  org: 1,
  merchant: 2,
  profile: 3,
  customer_cohort: 4,
  customer_id: 5,
  killswitch: 6,
} as const;

export type DimensionName = keyof typeof DIMENSION_POSITIONS;

function isDimensionName(name: string): name is DimensionName {
  // Object.hasOwn, not `in`: `in` also matches Object.prototype keys, so a
  // condition carrying `toString` or `constructor` would index a function,
  // making the weight NaN - and NaN compares false against every other weight,
  // breaking precedence silently instead of loudly.
  return Object.hasOwn(DIMENSION_POSITIONS, name);
}

/** The weight Superposition will give a context naming these dimensions. */
export function weightOf(condition: Record<string, unknown>): number {
  return Object.keys(condition)
    .filter(isDimensionName)
    .reduce((sum, name) => sum + 2 ** DIMENSION_POSITIONS[name], 0);
}
