import { DIMENSION_POSITIONS } from '../model/dimensions.js';
import type { ControlPlane, DimensionSpec } from './controlPlane.js';

/** Customer ids belonging to each cohort. Demo-sized, so membership is a list. */
export const COHORTS = {
  gold: ['cust_001', 'cust_002'],
  high_risk: ['cust_009'],
} as const;

export type CohortName = keyof typeof COHORTS | 'otherwise';

/** Every cohort name plus the mandatory fallback. */
export const COHORT_NAMES: CohortName[] = [...Object.keys(COHORTS) as (keyof typeof COHORTS)[], 'otherwise'];

/**
 * A local cohort groups a parent dimension's values with JSONLogic evaluated
 * client-side. `in` with an explicit list is the form Superposition documents,
 * so it needs no assumption about which JSONLogic operators are supported.
 * "otherwise" is required in the enum as the fallback.
 */
function cohortSchema(): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  for (const [name, members] of Object.entries(COHORTS)) {
    definitions[name] = { in: [{ var: 'customer_id' }, [...members]] };
  }
  return { type: 'string', enum: COHORT_NAMES, definitions };
}

export const DIMENSION_SPECS: DimensionSpec[] = [
  { name: 'org', position: DIMENSION_POSITIONS.org, schema: { type: 'string' }, description: 'Organization id' },
  { name: 'merchant', position: DIMENSION_POSITIONS.merchant, schema: { type: 'string' }, description: 'Merchant id' },
  { name: 'profile', position: DIMENSION_POSITIONS.profile, schema: { type: 'string' }, description: 'Profile id' },
  {
    name: 'customer_cohort',
    position: DIMENSION_POSITIONS.customer_cohort,
    schema: cohortSchema(),
    description: 'Customer cohort, derived from customer_id',
    localCohortOf: 'customer_id',
  },
  { name: 'customer_id', position: DIMENSION_POSITIONS.customer_id, schema: { type: 'string' }, description: 'Customer id' },
  { name: 'killswitch', position: DIMENSION_POSITIONS.killswitch, schema: { type: 'boolean' }, description: 'Emergency wholesale override' },
];

export interface FeatureDefault {
  key: string;
  value: unknown;
  schema: Record<string, unknown>;
  description: string;
}

/** One feature per quadrant of manageability x propagation. */
export const FEATURE_DEFAULTS: FeatureDefault[] = [
  {
    key: 'internal.inherited.decision_engine_rollout',
    value: 'off',
    schema: { type: 'string', enum: ['off', 'shadow', 'primary'] },
    description: 'How far the decision engine is rolled out. Operators only; inherited down the hierarchy.',
  },
  {
    key: 'internal.copied.connector_retry_budget',
    value: 3,
    schema: { type: 'integer', minimum: 0, maximum: 10 },
    description: 'Retry attempts per connector. Operators only; every level owns its own copy, frozen at creation.',
  },
  {
    key: 'external.inherited.payment_retries_enabled',
    value: true,
    schema: { type: 'boolean' },
    description: 'Whether failed payments are retried. Customer-manageable; inherited down the hierarchy.',
  },
  {
    key: 'external.copied_till_merchant.checkout_theme',
    value: 'classic',
    schema: { type: 'string', enum: ['classic', 'neo', 'minimal'] },
    description: 'Checkout appearance. Customer-manageable; copied down to merchant, inherited by profiles.',
  },
];

/**
 * Create dimensions and default configs. Safe to re-run: dimensions are
 * created-if-absent and feature defaults are written unconditionally, so a
 * bootstrap also RESETS any default an operator or a test changed. That reset
 * is deliberate - `npm run bootstrap` is the demo's "start over" button.
 *
 * Dimensions go first: a context or default config validated against a
 * dimension that does not exist yet is refused.
 *
 * Dimension creation order is more constrained than the clean, position-
 * ordered `DIMENSION_SPECS` array suggests, and both constraints below were
 * only found by probing the running instance (crates/context_aware_config/
 * src/api/dimension/validations.rs and handlers.rs confirm them in source):
 *
 *  1. A cohort's parent dimension must already exist - LOCAL_COHORT creation
 *     looks the parent up and 400s ("...has not been created or does not
 *     exist") if it is missing. So `customer_id` must exist before
 *     `customer_cohort` is created.
 *  2. A new dimension's `position` may not exceed the number of dimensions
 *     that already exist ("position value exceeds total number of
 *     dimensions"). Creating a dimension at an occupied position does not
 *     collide, though: the server shifts every existing dimension at or
 *     above that position up by one inside the same transaction, same as
 *     inserting into a sorted list by index.
 *
 * Here `customer_id` (position 5) must be created before `customer_cohort`
 * (position 4), but constraint 2 forbids giving it position 5 before 5
 * dimensions already exist. The fix: create it appended at the next free
 * slot - wherever that is - then create every other dimension in ascending
 * target-position order. Each of those inserts at or below `customer_id`'s
 * current slot shifts it up by one, so by the time `customer_cohort` (the
 * only dimension below it) is created, `customer_id` has been pushed from
 * its temporary slot to exactly position 5. Every other dimension is
 * created directly at its target position and is never shifted again,
 * because nothing is later inserted below it.
 *
 * `createDimension` is idempotent and leaves an existing dimension alone, so
 * on a re-run this whole dance is skipped - the parent is already there.
 */
export async function bootstrap(controlPlane: ControlPlane): Promise<void> {
  const cohortParentNames = new Set(
    DIMENSION_SPECS.filter((spec) => spec.localCohortOf).map((spec) => spec.localCohortOf!),
  );
  const parents = DIMENSION_SPECS.filter((spec) => cohortParentNames.has(spec.name));
  const rest = [...DIMENSION_SPECS]
    .filter((spec) => !cohortParentNames.has(spec.name))
    .sort((a, b) => a.position - b.position);

  for (const spec of parents) {
    const { length: nextFreeSlot } = await controlPlane.listDimensions();
    await controlPlane.createDimension({ ...spec, position: nextFreeSlot });
  }
  for (const spec of rest) {
    await controlPlane.createDimension(spec);
  }

  for (const feature of FEATURE_DEFAULTS) {
    await controlPlane.putDefaultConfig(
      feature.key, feature.value, feature.schema, feature.description,
    );
  }
}
