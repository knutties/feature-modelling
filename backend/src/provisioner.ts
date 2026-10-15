import { buildCatalog } from './catalog.js';
import type { Entity, EntityStore } from './entities.js';
import {
  type EntityPath, encodePath, levelOf, parentPath, pathToCondition, validateEntityId,
} from './model/hierarchy.js';
import { planCopies, shouldCopy } from './model/provisioning.js';
import type { ControlPlane } from './superposition/controlPlane.js';

export class ProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisionError';
  }
}

export interface CopyReport {
  key: string;
  value: unknown;
  fromPath: EntityPath;
}

export interface SkipReport {
  key: string;
  reason: string;
}

export interface CreateEntityResult {
  entity: Entity;
  copied: CopyReport[];
  /** Copied features deliberately NOT written here - the interesting half of the report. */
  skipped: SkipReport[];
}

export class Provisioner {
  constructor(
    private readonly controlPlane: ControlPlane,
    private readonly store: EntityStore,
  ) {}

  /**
   * Create an entity and materialize every copy its level owns.
   *
   * Validation runs before any write, so a rejected creation leaves no orphan
   * context behind. The duplicate check matters more than it looks: because
   * CreateContext merges, creating the same entity twice would silently
   * overwrite the first one's frozen copies with freshly resolved values,
   * destroying exactly the history a copied feature exists to preserve.
   */
  async createEntity(input: { path: EntityPath; name: string }): Promise<CreateEntityResult> {
    const { path, name } = input;

    if (path.length === 0) throw new ProvisionError('an entity path cannot be empty');
    path.forEach(validateEntityId);
    levelOf(path); // throws if deeper than the hierarchy

    if (this.store.exists(path)) {
      throw new ProvisionError(`entity ${encodePath(path)} already exists`);
    }

    const parent = parentPath(path);
    if (parent.length > 0 && !this.store.exists(parent)) {
      throw new ProvisionError(
        `cannot create ${encodePath(path)}: parent ${encodePath(parent)} does not exist`,
      );
    }

    const entity = this.store.add({ id: path[path.length - 1]!, name, path });

    try {
      const { copied, skipped } = await this.materializeCopies(path);
      return { entity, copied, skipped };
    } catch (error) {
      // The entity stays, flagged, so the operator can retry rather than
      // being left with a half-provisioned entity and no way to name it.
      this.store.setState(path, 'provisioning_failed');
      throw error;
    }
  }

  /**
   * Re-run provisioning for an entity. Safe to repeat: each copy is written
   * with CreateContext, which merges, so re-writing a copy that already landed
   * changes nothing.
   */
  async retry(path: EntityPath): Promise<CreateEntityResult> {
    const entity = this.store.get(path);
    if (!entity) throw new ProvisionError(`no entity at ${encodePath(path)}`);
    const { copied, skipped } = await this.materializeCopies(path);
    this.store.setState(path, 'ok');
    return { entity, copied, skipped };
  }

  private async materializeCopies(
    path: EntityPath,
  ): Promise<{ copied: CopyReport[]; skipped: SkipReport[] }> {
    const catalog = buildCatalog(await this.controlPlane.listDefaultConfigs());
    const features = catalog.map((entry) => entry.feature);
    const level = levelOf(path);

    const plan = planCopies(features, path);
    const copied: CopyReport[] = [];
    const override: Record<string, unknown> = {};

    for (const item of plan) {
      // Authoritative, uncached: a copy is frozen forever, so a stale read
      // here would bake in a wrong value with nothing to correct it later.
      const parentConfig = await this.controlPlane.resolve({
        ...pathToCondition(item.fromPath),
        killswitch: false,
      });
      const value = parentConfig[item.key];
      if (value === undefined) {
        throw new ProvisionError(
          `cannot copy ${item.key} for ${encodePath(path)}: the parent resolved no value`,
        );
      }
      override[item.key] = value;
      copied.push({ key: item.key, value, fromPath: item.fromPath });
    }

    if (Object.keys(override).length > 0) {
      await this.controlPlane.putContext(
        pathToCondition(path),
        override,
        `provision ${encodePath(path)}`,
      );
    }

    const skipped: SkipReport[] = features
      .filter((feature) => feature.propagation.kind === 'copied' && !shouldCopy(feature, level))
      .map((feature) => ({
        key: feature.key,
        reason:
          `copied only down to ${(feature.propagation as { till: string }).till}; ` +
          `a ${level} inherits it`,
      }));

    return { copied, skipped };
  }
}
