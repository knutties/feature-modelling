import { type EntityPath, conditionToPath, samePath } from './hierarchy.js';

/** One step of GetResolvedConfigExplanation's timeline. */
export interface TimelineItem {
  context_id: string;
  condition: Record<string, unknown>;
  override_id: string;
  value_before: unknown;
  value_after: unknown;
}

export type Provenance =
  | { kind: 'default' }
  | { kind: 'own' }
  | { kind: 'inherited'; fromPath: EntityPath }
  | { kind: 'cohort'; cohort: string }
  | { kind: 'killswitch' };

/**
 * Where an entity's resolved value came from, read off the resolver's own
 * explanation rather than recomputed.
 *
 * Only the last timeline step matters: it is the highest-weight context that
 * applied, so it is the one that set the final value. Crucially this reads the
 * step's *condition*, never its value — immediately after a copy an entity and
 * its parent hold the same value, so a value comparison would call an owned
 * value inherited exactly when the distinction matters most.
 */
export function provenanceOf(
  timeline: readonly TimelineItem[],
  path: EntityPath,
): Provenance {
  const last = timeline[timeline.length - 1];
  if (!last) return { kind: 'default' };

  const { condition } = last;
  if ('killswitch' in condition) return { kind: 'killswitch' };
  if ('customer_cohort' in condition) {
    return { kind: 'cohort', cohort: String(condition['customer_cohort']) };
  }

  const conditionPath = conditionToPath(condition);
  if (samePath(conditionPath, path)) return { kind: 'own' };
  return { kind: 'inherited', fromPath: conditionPath };
}

export function describeProvenance(provenance: Provenance): string {
  switch (provenance.kind) {
    case 'default':
      return 'platform default';
    case 'own':
      return 'own';
    case 'inherited':
      return `inherited from ${provenance.fromPath.join('/')}`;
    case 'cohort':
      return `cohort ${provenance.cohort}`;
    case 'killswitch':
      return 'kill switch engaged';
    default: {
      // `noImplicitReturns` is not part of `strict`, so without this branch a
      // sixth Provenance variant would fall off the end of a `string`-returning
      // function and silently label itself `undefined` in the UI. Assigning the
      // narrowed-to-never value makes that a compile error instead, naming the
      // variant that was not handled.
      const _never: never = provenance;
      throw new Error(`unhandled provenance ${JSON.stringify(_never)}`);
    }
  }
}
