import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type EntityPath, type Level, encodePath, levelOf, parentPath, samePath,
  validateEntityId,
} from './model/hierarchy.js';

export type ProvisioningState = 'ok' | 'provisioning_failed';

export interface Entity {
  id: string;
  name: string;
  path: EntityPath;
  level: Level;
  provisioningState: ProvisioningState;
}

export interface EntityNode {
  entity: Entity;
  children: EntityNode[];
}

export interface NewEntity {
  id: string;
  name: string;
  path: EntityPath;
  provisioningState?: ProvisioningState;
}

/**
 * The entity hierarchy, as a JSON file. Deliberately not a database: the spec
 * puts entity attributes out of scope, so this holds only the shape of the
 * hierarchy, and a reader can `cat` it to see the demo's whole state.
 */
export class EntityStore {
  private entities: Entity[] = [];

  constructor(private readonly file: string) {
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Entity[];
      this.entities = raw.map((entity) => ({ ...entity, path: entity.path }));
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(this.entities, null, 2)}\n`);
  }

  all(): Entity[] {
    return [...this.entities];
  }

  get(path: EntityPath): Entity | undefined {
    return this.entities.find((entity) => samePath(entity.path, path));
  }

  exists(path: EntityPath): boolean {
    return this.get(path) !== undefined;
  }

  /** Direct children only. The empty path gives the roots. */
  children(path: EntityPath): Entity[] {
    return this.entities.filter(
      (entity) =>
        entity.path.length === path.length + 1 && samePath(parentPath(entity.path), path),
    );
  }

  add(entity: NewEntity): Entity {
    entity.path.forEach(validateEntityId);
    validateEntityId(entity.id);
    const stored: Entity = {
      id: entity.id,
      name: entity.name,
      path: [...entity.path],
      level: levelOf(entity.path),
      provisioningState: entity.provisioningState ?? 'ok',
    };
    this.entities.push(stored);
    this.persist();
    return stored;
  }

  setState(path: EntityPath, state: ProvisioningState): void {
    const entity = this.get(path);
    if (!entity) throw new Error(`no entity at ${encodePath(path)}`);
    entity.provisioningState = state;
    this.persist();
  }

  tree(): EntityNode[] {
    const build = (path: EntityPath): EntityNode[] =>
      this.children(path)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entity) => ({ entity, children: build(entity.path) }));
    return build([]);
  }
}
