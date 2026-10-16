import { DIMENSION_POSITIONS } from '../model/dimensions.js';
import type { ControlPlane, DimensionSpec } from './controlPlane.js';

/** Customer ids belonging to each cohort. Demo-sized, so membership is a list. */
export const COHORTS = {
  gold: ['cust_001', 'cust_002'],
  high_risk: ['cust_009'],
} as const;

/**
 * The dimension `customer_cohort` is a local cohort OF. It appears twice - in
 * the JSONLogic each cohort definition evaluates, and in the `LOCAL_COHORT`
 * declaration Superposition stores - and the two must name the same dimension
 * or the cohort silently never matches. One constant, used in both places, so
 * renaming the parent cannot desync them.
 */
export const COHORT_PARENT = 'customer_id';

export type CohortName = keyof typeof COHORTS | 'otherwise';

/** Every cohort name plus the mandatory fallback. */
export const COHORT_NAMES: CohortName[] = [...Object.keys(COHORTS) as (keyof typeof COHORTS)[], 'otherwise'];

/**
 * A local cohort groups a parent dimension's values with JSONLogic evaluated
 * client-side. `in` with an explicit list is the form Superposition documents,
 * so it needs no assumption about which JSONLogic operators are supported.
 * "otherwise" is required in the enum as the fallback.
 *
 * `parentName` is a parameter rather than a literal so the dimension it reads
 * (`{ var: ... }`) is necessarily the same one declared as `localCohortOf`
 * below - see COHORT_PARENT.
 */
function cohortSchema(parentName: string): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  for (const [name, members] of Object.entries(COHORTS)) {
    definitions[name] = { in: [{ var: parentName }, [...members]] };
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
    schema: cohortSchema(COHORT_PARENT),
    description: `Customer cohort, derived from ${COHORT_PARENT}`,
    localCohortOf: COHORT_PARENT,
  },
  { name: COHORT_PARENT, position: DIMENSION_POSITIONS.customer_id, schema: { type: 'string' }, description: 'Customer id' },
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
 * Guard against a workspace that has drifted from `DIMENSION_SPECS` - a
 * dimension added or edited by hand, or a previous run that crashed between
 * dimension creations. Superposition weights a context as the sum of
 * 2^position over the dimensions it names, highest wins, so a single wrong
 * position breaks precedence with no symptom other than the demo quietly
 * resolving the wrong value. Throwing here turns that silent failure into a
 * loud one, naming every dimension whose live position does not match its
 * spec.
 */
async function assertDimensionPositions(controlPlane: ControlPlane): Promise<void> {
  const actual = new Map(
    (await controlPlane.listDimensions()).map((d) => [d.dimension, d.position]),
  );
  const wrong = DIMENSION_SPECS
    .filter((spec) => actual.get(spec.name) !== spec.position)
    .map((spec) => `${spec.name}: expected ${spec.position}, got ${actual.get(spec.name) ?? 'absent'}`);
  if (wrong.length > 0) {
    throw new Error(
      `dimension positions are wrong, so context precedence is broken: ${wrong.join('; ')}. `
      + 'Priority is the sum of 2^position over the dimensions a context names, and the '
      + 'highest sum wins, so a wrong position silently breaks inheritance between entities, '
      + 'cohorts, and the kill switch. The workspace has likely drifted from DIMENSION_SPECS '
      + '(a dimension created or edited outside bootstrap, or a previous run that crashed '
      + 'mid-way) - inspect its dimensions before resolving configs against it.',
    );
  }
}

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
 *
 * That shift-on-insert arithmetic is correct for a workspace that only ever
 * goes through this function, but it depends on the exact starting state:
 * a dimension added by hand through the admin UI, or a run that crashed
 * half-way, could leave positions that this function's own createDimension
 * calls would then never correct (createDimension leaves an existing
 * dimension alone). Wrong positions break precedence silently - priority is
 * the sum of 2^position, so one wrong position can flip which context wins
 * with no error anywhere - so `assertDimensionPositions` reads the
 * dimensions back after creation and fails loudly if any position drifted
 * from `DIMENSION_SPECS`, rather than letting the demo misbehave quietly.
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

  await assertDimensionPositions(controlPlane);

  for (const feature of FEATURE_DEFAULTS) {
    await controlPlane.putDefaultConfig(
      feature.key, feature.value, feature.schema, feature.description,
    );
  }
}
