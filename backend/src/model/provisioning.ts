import type { FeatureKey } from './featureKey.js';
import { type EntityPath, type Level, levelIndex, levelOf, parentPath } from './hierarchy.js';

export interface CopyPlanItem {
  /** The feature key to freeze. */
  key: string;
  /** The ancestor whose resolved value becomes the frozen value. Empty for an org. */
  fromPath: EntityPath;
}

/**
 * Whether an entity at `level` materializes its own copy of `feature`.
 *
 * True when the feature is copied and the level is at or above the copy
 * boundary. Levels below the boundary write nothing and inherit from the
 * nearest owner.
 */
export function shouldCopy(feature: FeatureKey, level: Level): boolean {
  if (feature.propagation.kind !== 'copied') return false;
  return levelIndex(level) <= levelIndex(feature.propagation.till);
}

/** Every copy a newly created entity at `path` must materialize. */
export function planCopies(
  features: readonly FeatureKey[],
  path: EntityPath,
): CopyPlanItem[] {
  const level = levelOf(path);
  const fromPath = parentPath(path);
  return features
    .filter((feature) => shouldCopy(feature, level))
    .map((feature) => ({ key: feature.key, fromPath }));
}
