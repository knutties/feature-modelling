import { type CatalogEntry, buildCatalog, visibleCatalog } from './catalog.js';
import type { FeatureKey } from './model/featureKey.js';
import { type EntityPath, pathToCondition } from './model/hierarchy.js';
import { type Persona, assertCanManage, resolvePrefixes } from './model/persona.js';
import {
  type Provenance, type TimelineItem, describeProvenance, provenanceOf,
} from './model/provenance.js';
import type { ControlPlane } from './superposition/controlPlane.js';
import { COHORTS, COHORT_NAMES, type CohortName } from './superposition/schema.js';

/**
 * The shape of Task 10's `ApplicationReader` that `resolveAs` needs. Declared
 * locally rather than imported from `./superposition/readPath.js`, which does
 * not exist until Task 10 - importing a type from a module that is not there
 * yet would fail module resolution even for a type-only import. TypeScript's
 * structural typing means the real `ApplicationReader` class satisfies this
 * interface without either side needing to change once Task 10 lands.
 */
export interface ApplicationReader {
  resolveAll(context: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class FeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureError';
  }
}

export interface FeatureView {
  feature: FeatureKey;
  schema: Record<string, unknown>;
  description: string;
  value: unknown;
  provenance: Provenance;
  provenanceLabel: string;
  editable: boolean;
}

export interface ResolvedView {
  config: Record<string, unknown>;
  /** The cohort the local-cohort dimension computed for this customer. */
  cohort: CohortName;
}

/** The kill switch context's condition. Weight 64 beats every other combination. */
const KILLSWITCH_CONDITION = { killswitch: true } as const;

export class FeatureService {
  /**
   * `reader` is the OpenFeature provider, used ONLY by resolveAs so the probe
   * shows what an application embedding Superposition would see. Everything
   * else - viewFor, and provisioning in Provisioner - goes through the control
   * plane, which is uncached and authoritative. Omit it in tests that only
   * exercise management reads.
   */
  constructor(
    private readonly controlPlane: ControlPlane,
    private readonly reader?: ApplicationReader,
  ) {}

  async catalog(persona: Persona): Promise<CatalogEntry[]> {
    const all = buildCatalog(await this.controlPlane.listDefaultConfigs());
    return visibleCatalog(all, persona);
  }

  private async entry(key: string, persona: Persona): Promise<CatalogEntry> {
    const all = buildCatalog(await this.controlPlane.listDefaultConfigs());
    const found = all.find((e) => e.feature.key === key);
    if (!found) throw new FeatureError(`${JSON.stringify(key)} is not a known feature`);
    assertCanManage(persona, found.feature);
    return found;
  }

  /** Each visible feature's resolved value plus where it came from. */
  async viewFor(path: EntityPath, persona: Persona): Promise<FeatureView[]> {
    const entries = await this.catalog(persona);
    const condition = { ...pathToCondition(path), killswitch: false };
    const [config, overrideById] = await Promise.all([
      this.controlPlane.resolve(condition, {
        ...(resolvePrefixes(persona) ? { prefix: resolvePrefixes(persona)! } : {}),
      }),
      this.overridesByContextId(),
    ]);

    const views: FeatureView[] = [];
    for (const entry of entries) {
      const timeline = await this.controlPlane.explain(entry.feature.key, condition);
      const provenance = provenanceOf(ownedSteps(timeline, entry.feature.key, overrideById), path);
      views.push({
        feature: entry.feature,
        schema: entry.schema,
        description: entry.description,
        value: config[entry.feature.key],
        provenance,
        provenanceLabel: describeProvenance(provenance),
        editable: true,
      });
    }
    return views;
  }

  async explain(path: EntityPath, key: string): Promise<TimelineItem[]> {
    const condition = { ...pathToCondition(path), killswitch: false };
    const [timeline, overrideById] = await Promise.all([
      this.controlPlane.explain(key, condition),
      this.overridesByContextId(),
    ]);
    return ownedSteps(timeline, key, overrideById);
  }

  /**
   * `GetResolvedConfigExplanationCommand` includes a timeline entry for EVERY
   * context whose condition matches the resolution condition, whether or not
   * that context's override actually names the explained key - confirmed
   * against crates/context_aware_config/src/api/config/helpers.rs, which pushes
   * a step per matching context unconditionally and leaves `value_after`
   * identical to `value_before` when the key is absent from that context's
   * override. A deeper entity that owns some OTHER copied feature therefore
   * produces a trailing pass-through step for keys it does not own, which
   * would make `provenanceOf` - written against a timeline of true owners -
   * misreport that entity as the owner. This cross-references each step's
   * `context_id` against the live override map so only genuine owners reach
   * `provenanceOf`.
   */
  private async overridesByContextId(): Promise<Map<string, Record<string, unknown>>> {
    const contexts = await this.controlPlane.listContexts();
    return new Map(contexts.map((row) => [row.id, row.override]));
  }

  /**
   * Set this entity's own value. One call: CreateContext creates the context if
   * the condition is new and merges this key in if it is not, leaving the
   * entity's other overrides untouched. Superposition validates the value
   * against the key's schema and rejects it, which we let through unaltered.
   */
  async setValue(
    path: EntityPath,
    key: string,
    value: unknown,
    persona: Persona,
  ): Promise<void> {
    await this.entry(key, persona);
    await this.controlPlane.putContext(
      pathToCondition(path),
      { [key]: value },
      `set ${key} on ${path.join('/')}`,
    );
  }

  /**
   * Drop this entity's own value so the feature inherits again.
   */
  async revert(path: EntityPath, key: string, persona: Persona): Promise<void> {
    await this.entry(key, persona);
    await this.removeKey(pathToCondition(path), key, `revert ${key} on ${path.join('/')}`);
  }

  /** Specialize a feature for a cohort beneath an entity. Weight 30 beats the entity's 14. */
  async setCohortValue(
    path: EntityPath,
    cohort: string,
    key: string,
    value: unknown,
    persona: Persona,
  ): Promise<void> {
    if (!(COHORT_NAMES as string[]).includes(cohort)) {
      throw new FeatureError(
        `unknown cohort ${JSON.stringify(cohort)}; expected ${COHORT_NAMES.join(', ')}`,
      );
    }
    await this.entry(key, persona);
    await this.controlPlane.putContext(
      { ...pathToCondition(path), customer_cohort: cohort },
      { [key]: value },
      `specialize ${key} for cohort ${cohort}`,
    );
  }

  /**
   * Engage the emergency override. One context at weight 64 outranks every
   * entity and cohort override, which stay on disk untouched - so disengaging
   * restores the previous world exactly.
   */
  async engageKillSwitch(key: string, value: unknown, persona: Persona): Promise<void> {
    if (persona !== 'operator') {
      throw new FeatureError('only an operator may engage the kill switch');
    }
    await this.entry(key, persona);
    await this.controlPlane.putContext(
      KILLSWITCH_CONDITION, { [key]: value }, `kill switch on ${key}`,
    );
  }

  async disengageKillSwitch(key: string, persona: Persona): Promise<void> {
    if (persona !== 'operator') {
      throw new FeatureError('only an operator may disengage the kill switch');
    }
    await this.entry(key, persona);
    await this.removeKey(KILLSWITCH_CONDITION, key, `kill switch off ${key}`);
  }

  /**
   * Remove one key from a context's overrides, deleting the context outright
   * if that key was its last. The only way to shrink an override set: every
   * write API merges, so neither CreateContext nor UpdateOverride can remove
   * a key - `revert` and `disengageKillSwitch` are the only two operations
   * that shrink an override set, and both go through this one path so a
   * future guard added to one cannot silently miss the other.
   */
  private async removeKey(
    condition: Record<string, unknown>,
    key: string,
    changeReason: string,
  ): Promise<void> {
    const existing = await this.controlPlane.getContext(condition);
    if (!existing || !(key in existing.override)) return;

    const remaining = { ...existing.override };
    delete remaining[key];
    await this.controlPlane.replaceContextOverrides(condition, remaining, changeReason);
  }

  /**
   * What the application sees for one customer, with the cohort it fell into.
   *
   * Reads through the provider when one was supplied, so the probe is genuinely
   * the application's view. A customer's prefix filter still has to be applied
   * here, because the provider resolves every key - so when a reader is used,
   * the filter is applied to its result rather than pushed into the query.
   */
  async resolveAs(
    path: EntityPath,
    customerId: string,
    persona: Persona,
    options: { killswitch?: boolean } = {},
  ): Promise<ResolvedView> {
    const context = {
      ...pathToCondition(path),
      customer_id: customerId,
      killswitch: options.killswitch ?? false,
    };
    const prefixes = resolvePrefixes(persona);

    if (this.reader) {
      const all = await this.reader.resolveAll(context);
      const config = prefixes
        ? Object.fromEntries(
            Object.entries(all).filter(([key]) =>
              prefixes.some((prefix) => key.startsWith(prefix)),
            ),
          )
        : all;
      return { config, cohort: cohortOf(customerId) };
    }

    const config = await this.controlPlane.resolve(context, {
      ...(prefixes ? { prefix: prefixes } : {}),
    });
    return { config, cohort: cohortOf(customerId) };
  }
}

/**
 * Keep only timeline steps whose context genuinely overrides `key`, dropping
 * the pass-through steps Superposition's explain includes for any other
 * context that merely matches the condition. A step whose context no longer
 * exists in `overrideById` (should not happen inside one request, but cheap to
 * guard) is kept rather than silently dropped.
 */
function ownedSteps(
  timeline: readonly TimelineItem[],
  key: string,
  overrideById: ReadonlyMap<string, Record<string, unknown>>,
): TimelineItem[] {
  return timeline.filter((item) => {
    const override = overrideById.get(item.context_id);
    return override ? Object.hasOwn(override, key) : true;
  });
}

/**
 * Mirrors the local cohort's JSONLogic so the UI can show which cohort a
 * customer fell into. The authoritative evaluation is Superposition's, done
 * inside the provider; this is for display only. schema.ts holds the single
 * membership list both use, so the two cannot disagree.
 */
function cohortOf(customerId: string): CohortName {
  for (const [name, members] of Object.entries(COHORTS)) {
    if ((members as readonly string[]).includes(customerId)) return name as CohortName;
  }
  return 'otherwise';
}
