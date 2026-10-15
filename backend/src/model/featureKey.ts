import { LEVELS, type Level } from './hierarchy.js';

export type Manageability = 'internal' | 'external';

/**
 * How a feature's value reaches an entity.
 *
 * `inherited` writes nothing at entity creation; the cascade resolves it from
 * the nearest ancestor that has a value.
 *
 * `copied` with boundary `till` means levels down to and including `till` own
 * their value, frozen from the parent at creation; levels below inherit from
 * the nearest owner. Bare `copied` in a key means till the deepest level.
 */
export type Propagation =
  | { kind: 'inherited' }
  | { kind: 'copied'; till: Level };

export interface FeatureKey {
  /** The full key as stored in Superposition. */
  key: string;
  manageability: Manageability;
  propagation: Propagation;
  /** Everything after the first two segments, dots included. */
  name: string;
}

export class FeatureKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureKeyError';
  }
}

/** Superposition's own config-key charset. Enforced here so a bad key fails in our tests, not at the API. */
const SUPERPOSITION_KEY_RE =
  /^[a-zA-Z0-9\-_]([a-zA-Z0-9\-_.]{0,254}[a-zA-Z0-9\-_])?$/;

const COPY_BOUNDARY_RE = /^copied_till_(.+)$/;

export const DEEPEST_LEVEL: Level = LEVELS[LEVELS.length - 1]!;

const MANAGEABILITIES: readonly Manageability[] = ['internal', 'external'];

function isManageability(value: string): value is Manageability {
  return (MANAGEABILITIES as readonly string[]).includes(value);
}

function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

function parsePropagation(raw: string, key: string): Propagation {
  if (raw === 'inherited') return { kind: 'inherited' };
  if (raw === 'copied') return { kind: 'copied', till: DEEPEST_LEVEL };

  const boundary = COPY_BOUNDARY_RE.exec(raw);
  if (boundary) {
    const till = boundary[1]!;
    if (!isLevel(till)) {
      throw new FeatureKeyError(
        `key ${JSON.stringify(key)} names copy boundary ${JSON.stringify(till)}, ` +
          `which is not one of ${LEVELS.join(', ')}`,
      );
    }
    return { kind: 'copied', till };
  }

  throw new FeatureKeyError(
    `key ${JSON.stringify(key)} has unknown propagation ${JSON.stringify(raw)}; ` +
      `expected 'inherited', 'copied', or 'copied_till_<level>'`,
  );
}

export function parseFeatureKey(key: string): FeatureKey {
  if (!SUPERPOSITION_KEY_RE.test(key)) {
    throw new FeatureKeyError(
      `${JSON.stringify(key)} is not a legal Superposition config key; ` +
        `allowed characters are [a-zA-Z0-9-_.] and it may not start or end with '.'`,
    );
  }

  const segments = key.split('.');
  if (segments.length < 3) {
    throw new FeatureKeyError(
      `key ${JSON.stringify(key)} needs at least 3 dot-separated segments: ` +
        `<manageability>.<propagation>.<name>`,
    );
  }

  const [manageability, propagation, ...nameParts] = segments as [string, string, ...string[]];
  if (!isManageability(manageability)) {
    throw new FeatureKeyError(
      `key ${JSON.stringify(key)} has unknown manageability ` +
        `${JSON.stringify(manageability)}; expected 'internal' or 'external'`,
    );
  }

  return {
    key,
    manageability,
    propagation: parsePropagation(propagation, key),
    name: nameParts.join('.'),
  };
}

/** For keys that may not belong to us at all, such as one added by hand in the admin UI. */
export function tryParseFeatureKey(key: string): FeatureKey | null {
  try {
    return parseFeatureKey(key);
  } catch {
    return null;
  }
}

export function formatFeatureKey(
  manageability: Manageability,
  propagation: Propagation,
  name: string,
): string {
  const segment =
    propagation.kind === 'inherited'
      ? 'inherited'
      : propagation.till === DEEPEST_LEVEL
        ? 'copied'
        : `copied_till_${propagation.till}`;
  return `${manageability}.${segment}.${name}`;
}
