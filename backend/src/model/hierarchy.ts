/** The entity hierarchy, shallowest first. Index is depth. */
export const LEVELS = ['org', 'merchant', 'profile'] as const;
export type Level = (typeof LEVELS)[number];

/**
 * An entity's ancestry as ids, shallowest first: ['acme', 'm1'] is merchant m1
 * of org acme. Length determines the level, so the path is the identity.
 */
export type EntityPath = readonly string[];

/** Separator for a path in a URL. Deliberately outside ENTITY_ID_RE. */
export const PATH_SEPARATOR = '~';

const ENTITY_ID_RE = /^[a-zA-Z0-9_-]+$/;

export class HierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HierarchyError';
  }
}

export function levelIndex(level: Level): number {
  return LEVELS.indexOf(level);
}

export function levelOf(path: EntityPath): Level {
  const level = LEVELS[path.length - 1];
  if (!level) {
    throw new HierarchyError(
      `no level for a path of depth ${path.length}; expected 1..${LEVELS.length}`,
    );
  }
  return level;
}

export function parentPath(path: EntityPath): EntityPath {
  return path.slice(0, -1);
}

/** Proper ancestors, shallowest first. An org has none. */
export function ancestorPaths(path: EntityPath): EntityPath[] {
  const out: EntityPath[] = [];
  for (let i = 1; i < path.length; i += 1) out.push(path.slice(0, i));
  return out;
}

export function pathToCondition(path: EntityPath): Record<string, string> {
  const condition: Record<string, string> = {};
  path.forEach((id, index) => {
    const level = LEVELS[index];
    if (!level) throw new HierarchyError(`path is deeper than the hierarchy: ${path.join('/')}`);
    condition[level] = id;
  });
  return condition;
}

/**
 * The entity path a condition names. Stops at the first absent level, so a
 * cohort or killswitch condition yields only the entity part.
 */
export function conditionToPath(condition: Record<string, unknown>): EntityPath {
  const path: string[] = [];
  for (const level of LEVELS) {
    const value = condition[level];
    if (value === undefined) break;
    path.push(String(value));
  }
  return path;
}

export function validateEntityId(id: string): void {
  if (!ENTITY_ID_RE.test(id)) {
    throw new HierarchyError(
      `entity id ${JSON.stringify(id)} must match ${ENTITY_ID_RE.source}; ` +
        `'.' and '${PATH_SEPARATOR}' are not allowed`,
    );
  }
}

export function encodePath(path: EntityPath): string {
  return path.join(PATH_SEPARATOR);
}

export function decodePath(encoded: string): EntityPath {
  const parts = encoded.split(PATH_SEPARATOR);
  if (parts.length < 1 || parts.length > LEVELS.length || encoded.length === 0) {
    throw new HierarchyError(
      `${JSON.stringify(encoded)} is not an entity path of depth 1..${LEVELS.length}`,
    );
  }
  parts.forEach(validateEntityId);
  return parts;
}

export function samePath(a: EntityPath, b: EntityPath): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
