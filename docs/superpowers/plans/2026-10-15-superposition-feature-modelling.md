# Superposition Feature Modelling Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a running demo that shows features classified by manageability (internal/external) and propagation (inherited/copied) over an org→merchant→profile hierarchy in Superposition, with cohort specialization and a kill switch.

**Architecture:** A single Superposition workspace holds six dimensions whose positions encode hierarchy depth; feature classification lives in the config key itself (`<manageability>.<propagation>.<name>`). Inheritance is Superposition's cascade, not our code; copying is the only propagation we implement, materializing a frozen override at entity-creation time. A Node/TS backend wraps the SDK (writes, authoritative reads) and the OpenFeature provider (application reads); a React SPA presents it with a persona toggle.

**Tech Stack:** Node 22, TypeScript 5.6, Express 4, `superposition-sdk@0.118.2`, `superposition-provider@0.118.2`, `@openfeature/server-sdk@1.23`, Vitest 2, Vite 5 + React 18, npm workspaces.

**Spec:** [`docs/superpowers/specs/2026-10-15-superposition-feature-modelling-design.md`](../specs/2026-10-15-superposition-feature-modelling-design.md)

## Global Constraints

- Superposition endpoint `http://localhost:8080`; org `localorg`; demo workspace `featuredemo`; integration-test workspace `featuredemo_test`.
- Auth is permissive locally. The SDK client takes `token: { token: "some-token" }` — a nested object, not a bare string.
- npm package names are `superposition-sdk` and `superposition-provider` (**not** `@juspay/...`, which is the in-repo name only). Both at `0.118.2`.
- Config keys must match `^[a-zA-Z0-9-_]([a-zA-Z0-9-_.]{0,254}[a-zA-Z0-9-_])?$`. No `@`, no leading/trailing dot.
- Dimension positions are exactly: `org` 1, `merchant` 2, `profile` 3, `customer_cohort` 4, `customer_id` 5, `killswitch` 6. Priority is Σ2^position; these values are load-bearing and must not be changed casually.
- A cohort dimension's position must be ≤ its parent's. `customer_cohort` (4) ≤ `customer_id` (5).
- A local cohort's `schema.enum` must include `"otherwise"`.
- Workspace names: ≤25 chars, `[a-zA-Z0-9_-]`, must not start with a digit.
- The provider is configured `{ ttl: 1, use_stale_on_error: true }` (on-demand refresh, not polling).
- Never read or write the nine pre-existing workspaces in `localorg` (`sdkv2`, `sdkv2itest`, `crt`, `mirror`, `shopconfig`, `a`, `tmp`, `dev`, `test`).
- Every Superposition write requires a non-empty `change_reason`.
- All backend source is ESM (`"type": "module"`); relative imports carry the `.js` extension even in `.ts` files.

### Spec corrections adopted here

Two spec statements proved wrong against the API and are corrected in this plan:

1. **Setting a key is one call, not three.** The spec specifies `GetContextFromCondition` → `UpdateOverride`-or-`CreateContext`. But `CreateContext` is `@idempotent` and merges on an existing condition (`handlers.rs:162-169` passes `replace: false`), so a single `CreateContext` creates-or-merges. Tasks 9 and 10 use the one-call form.
2. **Workspaces cannot be deleted.** There is no `DeleteWorkspace` operation. The spec's "created and dropped per run" is impossible. Instead `featuredemo_test` is created once if absent and **cleaned at the start of every run** (delete all contexts, then re-run bootstrap, which resets default-config values). Cleaning at start rather than end preserves the spec's intent — a crashed run cannot poison the next one — without accumulating workspaces.

## Review Focus

Five input classes the spec implies but whose behavior no task's happy path exercises. Each has a test pinned to the task owning the code.

1. **An entity id containing `~` or `.`** would corrupt both path encoding and the context condition. Expect rejection at id validation with a message naming the offending character. (Task 1, Task 8)
2. **A duplicate entity id under the same parent** must be rejected, not silently merged — `CreateContext`'s merge semantics would otherwise overwrite an existing entity's frozen copies with fresh ones. (Task 8)
3. **An entity whose parent does not exist** must be rejected before any Superposition write, so a failed create leaves no orphan context. (Task 8)
4. **A `default_config` key that does not parse** as `<manageability>.<propagation>.<name>` (someone adds one by hand in the admin UI) must be skipped with a warning, not crash the catalog. (Task 7)
5. **A value violating the key's JSON schema** (`connector_retry_budget = 99` against `maximum: 10`) must surface Superposition's own rejection verbatim and write nothing. (Task 9)

---

## File Structure

```
feature-modelling/
├── package.json                      npm workspaces root, convenience scripts
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── model/                    PURE - no network, no I/O
│   │   │   ├── hierarchy.ts          levels, entity paths, conditions, id validation
│   │   │   ├── dimensions.ts         dimension positions + priority arithmetic
│   │   │   ├── featureKey.ts         key scheme parse/format
│   │   │   ├── persona.ts            operator/customer -> visible prefixes
│   │   │   ├── provisioning.ts       which keys a new entity copies
│   │   │   └── provenance.ts         resolution timeline -> own/inherited/default
│   │   ├── superposition/
│   │   │   ├── config.ts             endpoint, org, workspace, token from env
│   │   │   ├── client.ts             SDK client construction
│   │   │   ├── controlPlane.ts       SDK wrapper: contexts, configs, resolve, explain
│   │   │   └── readPath.ts           OpenFeature provider wrapper
│   │   ├── catalog.ts                default_configs -> parsed feature catalog
│   │   ├── entities.ts               entity registry (JSON file)
│   │   ├── provisioner.ts            create entity + materialize copies
│   │   ├── features.ts               set / revert / cohort / killswitch
│   │   └── server.ts                 Express routes
│   ├── scripts/
│   │   ├── bootstrap.ts              workspace + dimensions + default configs
│   │   └── seed.ts                   demo entities for the walkthrough
│   └── test/
│       ├── unit/                     one file per model module
│       ├── integration/              against live Superposition
│       └── helpers/workspace.ts      test workspace lifecycle + cleanup
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx                   persona toggle + routing
        ├── api.ts                    typed fetch wrappers
        ├── ValueEditor.tsx           JSON-schema-driven input
        ├── Hierarchy.tsx             tree + create forms
        ├── EntityFeatures.tsx        feature table with provenance
        ├── CohortPanel.tsx           cohort specialization
        ├── KillSwitchPanel.tsx       operator-only emergency override
        └── ResolverProbe.tsx         what the application sees + timeline
```

`model/` is the whole feature model and has no imports outside itself. That boundary is what lets Tasks 1-5 be tested with no Superposition running, and it is where review effort belongs.

---

### Task 1: Scaffolding, hierarchy and priority arithmetic

**Files:**
- Create: `package.json`, `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`
- Create: `backend/src/model/hierarchy.ts`, `backend/src/model/dimensions.ts`
- Test: `backend/test/unit/hierarchy.test.ts`, `backend/test/unit/dimensions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Level`, `LEVELS`, `EntityPath`, `PATH_SEPARATOR`, `HierarchyError`, `levelIndex(level)`, `levelOf(path)`, `parentPath(path)`, `ancestorPaths(path)`, `pathToCondition(path)`, `conditionToPath(cond)`, `validateEntityId(id)`, `encodePath(path)`, `decodePath(s)`; and from `dimensions.ts`: `DIMENSION_POSITIONS`, `weightOf(condition)`.

- [ ] **Step 1: Create the workspace root and backend package**

`package.json`:

```json
{
  "name": "feature-modelling",
  "private": true,
  "workspaces": ["backend", "frontend"],
  "scripts": {
    "bootstrap": "npm run bootstrap -w backend",
    "seed": "npm run seed -w backend",
    "test": "npm run test -w backend",
    "test:integration": "npm run test:integration -w backend",
    "dev:backend": "npm run dev -w backend",
    "dev:frontend": "npm run dev -w frontend"
  }
}
```

`backend/package.json`:

```json
{
  "name": "backend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "bootstrap": "tsx scripts/bootstrap.ts",
    "seed": "tsx scripts/seed.ts",
    "test": "vitest run test/unit",
    "test:integration": "vitest run test/integration --no-file-parallelism"
  },
  "dependencies": {
    "@openfeature/server-sdk": "^1.23.0",
    "express": "^4.19.2",
    "superposition-provider": "0.118.2",
    "superposition-sdk": "0.118.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "scripts", "test"]
}
```

`backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

Then run: `npm install`

Expected: installs cleanly; `backend/node_modules/superposition-provider/dist/native-lib/` contains a `libsuperposition_core-*.dylib`.

- [ ] **Step 2: Write the failing hierarchy test**

`backend/test/unit/hierarchy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  HierarchyError, LEVELS, PATH_SEPARATOR, ancestorPaths, conditionToPath,
  decodePath, encodePath, levelIndex, levelOf, parentPath, pathToCondition,
  validateEntityId,
} from '../../src/model/hierarchy.js';

describe('levels', () => {
  it('orders org shallowest to profile deepest', () => {
    expect(LEVELS).toEqual(['org', 'merchant', 'profile']);
    expect(levelIndex('org')).toBe(0);
    expect(levelIndex('profile')).toBe(2);
  });

  it('derives the level from the path depth', () => {
    expect(levelOf(['acme'])).toBe('org');
    expect(levelOf(['acme', 'm1'])).toBe('merchant');
    expect(levelOf(['acme', 'm1', 'p1'])).toBe('profile');
  });

  it('rejects a path with no level', () => {
    expect(() => levelOf([])).toThrow(HierarchyError);
    expect(() => levelOf(['a', 'b', 'c', 'd'])).toThrow(HierarchyError);
  });
});

describe('paths', () => {
  it('gives an org an empty parent', () => {
    expect(parentPath(['acme'])).toEqual([]);
    expect(parentPath(['acme', 'm1'])).toEqual(['acme']);
    expect(parentPath(['acme', 'm1', 'p1'])).toEqual(['acme', 'm1']);
  });

  it('lists proper ancestors shallowest first', () => {
    expect(ancestorPaths(['acme', 'm1', 'p1'])).toEqual([['acme'], ['acme', 'm1']]);
    expect(ancestorPaths(['acme'])).toEqual([]);
  });

  it('round-trips a path through a condition', () => {
    expect(pathToCondition(['acme', 'm1'])).toEqual({ org: 'acme', merchant: 'm1' });
    expect(conditionToPath({ org: 'acme', merchant: 'm1' })).toEqual(['acme', 'm1']);
  });

  it('stops reading a condition at the first missing level', () => {
    expect(conditionToPath({ org: 'acme', profile: 'p1' })).toEqual(['acme']);
    expect(conditionToPath({ killswitch: true })).toEqual([]);
  });

  it('round-trips a path through its URL form', () => {
    expect(encodePath(['acme', 'm1', 'p1'])).toBe('acme~m1~p1');
    expect(decodePath('acme~m1~p1')).toEqual(['acme', 'm1', 'p1']);
    expect(decodePath('acme')).toEqual(['acme']);
  });
});

describe('entity id validation', () => {
  it('accepts alphanumerics, dash and underscore', () => {
    for (const id of ['acme', 'm-1', 'p_1', 'A9']) {
      expect(() => validateEntityId(id)).not.toThrow();
    }
  });

  // Review Focus 1: a separator or dot inside an id would corrupt both the URL
  // form and the Superposition condition.
  it('rejects an id containing the path separator', () => {
    expect(() => validateEntityId('ac~me')).toThrow(/~/);
  });

  it('rejects an id containing a dot', () => {
    expect(() => validateEntityId('ac.me')).toThrow(HierarchyError);
  });

  it('rejects an empty id', () => {
    expect(() => validateEntityId('')).toThrow(HierarchyError);
  });

  it('rejects a separator-bearing id when decoding a URL path', () => {
    expect(() => decodePath('acme~m.1')).toThrow(HierarchyError);
    expect(() => decodePath('')).toThrow(HierarchyError);
    expect(() => decodePath('a~b~c~d')).toThrow(HierarchyError);
  });

  it('keeps the separator out of the legal id charset', () => {
    expect(() => validateEntityId(PATH_SEPARATOR)).toThrow(HierarchyError);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npm test -w backend -- hierarchy`
Expected: FAIL — cannot resolve `../../src/model/hierarchy.js`.

- [ ] **Step 4: Implement hierarchy.ts**

`backend/src/model/hierarchy.ts`:

```ts
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
```

- [ ] **Step 5: Run it to make sure it passes**

Run: `npm test -w backend -- hierarchy`
Expected: PASS, 13 tests.

- [ ] **Step 6: Write the failing dimensions test**

`backend/test/unit/dimensions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DIMENSION_POSITIONS, weightOf } from '../../src/model/dimensions.js';

describe('dimension positions', () => {
  it('pins the positions the cascade depends on', () => {
    expect(DIMENSION_POSITIONS).toEqual({
      org: 1, merchant: 2, profile: 3, customer_cohort: 4, customer_id: 5, killswitch: 6,
    });
  });

  it('keeps a cohort at or below its parent dimension', () => {
    expect(DIMENSION_POSITIONS.customer_cohort).toBeLessThanOrEqual(
      DIMENSION_POSITIONS.customer_id,
    );
  });
});

describe('priority arithmetic', () => {
  it('weights a context as the sum of 2^position', () => {
    expect(weightOf({ org: 'acme' })).toBe(2);
    expect(weightOf({ org: 'acme', merchant: 'm1' })).toBe(6);
    expect(weightOf({ org: 'acme', merchant: 'm1', profile: 'p1' })).toBe(14);
  });

  // These three orderings are the model. If any fails, inheritance is broken.
  it('makes a deeper entity outrank a shallower one', () => {
    expect(weightOf({ org: 'a', merchant: 'm', profile: 'p' }))
      .toBeGreaterThan(weightOf({ org: 'a', merchant: 'm' }));
    expect(weightOf({ org: 'a', merchant: 'm' })).toBeGreaterThan(weightOf({ org: 'a' }));
  });

  it('makes a cohort outrank any entity path', () => {
    expect(weightOf({ org: 'a', merchant: 'm', profile: 'p', customer_cohort: 'gold' }))
      .toBe(30);
    expect(weightOf({ org: 'a', merchant: 'm', profile: 'p', customer_cohort: 'gold' }))
      .toBeGreaterThan(weightOf({ org: 'a', merchant: 'm', profile: 'p' }));
  });

  it('makes the kill switch outrank every other dimension combined', () => {
    const everythingElse = weightOf({
      org: 'a', merchant: 'm', profile: 'p', customer_cohort: 'gold', customer_id: 'c1',
    });
    expect(everythingElse).toBe(62);
    expect(weightOf({ killswitch: true })).toBe(64);
    expect(weightOf({ killswitch: true })).toBeGreaterThan(everythingElse);
  });

  it('ignores keys that are not dimensions', () => {
    expect(weightOf({ org: 'a', nonsense: 'x' })).toBe(2);
  });

  it('ignores inherited Object.prototype keys rather than yielding NaN', () => {
    expect(weightOf({ org: 'a', toString: 'x' })).toBe(2);
    expect(weightOf({ constructor: 'x' })).toBe(0);
  });
});
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `npm test -w backend -- dimensions`
Expected: FAIL — cannot resolve `../../src/model/dimensions.js`.

- [ ] **Step 8: Implement dimensions.ts**

`backend/src/model/dimensions.ts`:

```ts
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
```

- [ ] **Step 9: Run both unit suites**

Run: `npm test -w backend`
Expected: PASS, 20 tests across two files.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json backend/
git commit -m "feat(model): entity hierarchy and priority arithmetic

Positions are asserted in tests because the 2^position ordering is what
makes inheritance work, and a wrongly placed dimension would break it
silently."
```

---

### Task 2: Feature key scheme and persona

**Files:**
- Create: `backend/src/model/featureKey.ts`, `backend/src/model/persona.ts`
- Test: `backend/test/unit/featureKey.test.ts`, `backend/test/unit/persona.test.ts`

**Interfaces:**
- Consumes: `Level`, `LEVELS` from `model/hierarchy.js`.
- Produces: `Manageability`, `Propagation`, `FeatureKey`, `FeatureKeyError`, `DEEPEST_LEVEL`, `parseFeatureKey(key)`, `tryParseFeatureKey(key)`, `formatFeatureKey(m, p, name)`; and from `persona.ts`: `Persona`, `PersonaError`, `parsePersona(raw)`, `resolvePrefixes(persona)`, `canManage(persona, feature)`, `assertCanManage(persona, feature)`.

- [ ] **Step 1: Write the failing featureKey test**

`backend/test/unit/featureKey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FeatureKeyError, formatFeatureKey, parseFeatureKey, tryParseFeatureKey,
} from '../../src/model/featureKey.js';

describe('parseFeatureKey', () => {
  it('parses an inherited internal key', () => {
    expect(parseFeatureKey('internal.inherited.decision_engine_rollout')).toEqual({
      key: 'internal.inherited.decision_engine_rollout',
      manageability: 'internal',
      propagation: { kind: 'inherited' },
      name: 'decision_engine_rollout',
    });
  });

  it('expands bare `copied` to the deepest level', () => {
    expect(parseFeatureKey('internal.copied.connector_retry_budget').propagation)
      .toEqual({ kind: 'copied', till: 'profile' });
  });

  it('parses an explicit copy boundary', () => {
    expect(parseFeatureKey('external.copied_till_merchant.checkout_theme').propagation)
      .toEqual({ kind: 'copied', till: 'merchant' });
    expect(parseFeatureKey('external.copied_till_org.x').propagation)
      .toEqual({ kind: 'copied', till: 'org' });
  });

  it('keeps dots inside the name', () => {
    const parsed = parseFeatureKey('external.inherited.checkout.theme.v2');
    expect(parsed.name).toBe('checkout.theme.v2');
    expect(parsed.manageability).toBe('external');
  });

  it('rejects an unknown manageability', () => {
    expect(() => parseFeatureKey('wibble.inherited.x')).toThrow(/manageability/);
  });

  it('rejects an unknown propagation', () => {
    expect(() => parseFeatureKey('internal.wibble.x')).toThrow(/propagation/);
  });

  it('rejects a copy boundary naming a level that does not exist', () => {
    expect(() => parseFeatureKey('internal.copied_till_galaxy.x')).toThrow(/galaxy/);
  });

  it('rejects a key with too few segments', () => {
    expect(() => parseFeatureKey('internal.inherited')).toThrow(/segments/);
    expect(() => parseFeatureKey('solo')).toThrow(FeatureKeyError);
  });

  it('rejects keys Superposition itself would refuse', () => {
    expect(() => parseFeatureKey('internal.inherited.has@at')).toThrow(/legal/);
    expect(() => parseFeatureKey('.internal.inherited.x')).toThrow(/legal/);
    expect(() => parseFeatureKey('internal.inherited.x.')).toThrow(/legal/);
  });
});

describe('tryParseFeatureKey', () => {
  it('returns null instead of throwing', () => {
    expect(tryParseFeatureKey('not_a_feature')).toBeNull();
    expect(tryParseFeatureKey('external.inherited.ok')?.name).toBe('ok');
  });
});

describe('formatFeatureKey', () => {
  it('round-trips every propagation form', () => {
    for (const key of [
      'internal.inherited.a',
      'internal.copied.b',
      'external.copied_till_merchant.c',
      'external.copied_till_org.d',
    ]) {
      const parsed = parseFeatureKey(key);
      expect(formatFeatureKey(parsed.manageability, parsed.propagation, parsed.name))
        .toBe(key);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -w backend -- featureKey`
Expected: FAIL — cannot resolve `../../src/model/featureKey.js`.

- [ ] **Step 3: Implement featureKey.ts**

`backend/src/model/featureKey.ts`:

```ts
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
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npm test -w backend -- featureKey`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the failing persona test**

`backend/test/unit/persona.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFeatureKey } from '../../src/model/featureKey.js';
import {
  PersonaError, assertCanManage, canManage, parsePersona, resolvePrefixes,
} from '../../src/model/persona.js';

const internalFeature = parseFeatureKey('internal.inherited.decision_engine_rollout');
const externalFeature = parseFeatureKey('external.inherited.payment_retries_enabled');

describe('parsePersona', () => {
  it('defaults to operator when absent', () => {
    expect(parsePersona(undefined)).toBe('operator');
  });

  it('accepts the two personas', () => {
    expect(parsePersona('operator')).toBe('operator');
    expect(parsePersona('customer')).toBe('customer');
  });

  it('rejects anything else rather than silently widening access', () => {
    expect(() => parsePersona('admin')).toThrow(PersonaError);
    expect(() => parsePersona('internal')).toThrow(PersonaError);
  });
});

describe('resolvePrefixes', () => {
  // Pushed into the GetResolvedConfig call so internal keys are never returned,
  // rather than being fetched and filtered out afterwards.
  it('restricts a customer to external keys', () => {
    expect(resolvePrefixes('customer')).toEqual(['external.']);
  });

  it('does not filter for an operator', () => {
    expect(resolvePrefixes('operator')).toBeUndefined();
  });
});

describe('canManage', () => {
  it('lets an operator manage both classes', () => {
    expect(canManage('operator', internalFeature)).toBe(true);
    expect(canManage('operator', externalFeature)).toBe(true);
  });

  it('lets a customer manage only external features', () => {
    expect(canManage('customer', externalFeature)).toBe(true);
    expect(canManage('customer', internalFeature)).toBe(false);
  });

  it('throws with the key named when a customer reaches for an internal feature', () => {
    expect(() => assertCanManage('customer', internalFeature))
      .toThrow(/internal\.inherited\.decision_engine_rollout/);
    expect(() => assertCanManage('operator', internalFeature)).not.toThrow();
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `npm test -w backend -- persona`
Expected: FAIL — cannot resolve `../../src/model/persona.js`.

- [ ] **Step 7: Implement persona.ts**

`backend/src/model/persona.ts`:

```ts
import type { FeatureKey, Manageability } from './featureKey.js';

/**
 * Who is asking. Deliberately a different vocabulary from Manageability:
 * a persona is a role, manageability is a property of the feature.
 */
export type Persona = 'operator' | 'customer';

export class PersonaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaError';
  }
}

const VISIBLE: Record<Persona, readonly Manageability[]> = {
  operator: ['internal', 'external'],
  customer: ['external'],
};

const PERSONAS = Object.keys(VISIBLE) as Persona[];

export function parsePersona(raw: string | undefined): Persona {
  if (raw === undefined) return 'operator';
  if ((PERSONAS as string[]).includes(raw)) return raw as Persona;
  throw new PersonaError(
    `unknown persona ${JSON.stringify(raw)}; expected ${PERSONAS.join(' or ')}`,
  );
}

/**
 * Key prefixes to pass to GetResolvedConfig, or undefined for no filter.
 * Filtering at the resolve call means internal keys never reach this process
 * for a customer, rather than arriving and being dropped.
 */
export function resolvePrefixes(persona: Persona): string[] | undefined {
  if (persona === 'operator') return undefined;
  return VISIBLE[persona].map((manageability) => `${manageability}.`);
}

export function canManage(persona: Persona, feature: FeatureKey): boolean {
  return VISIBLE[persona].includes(feature.manageability);
}

export function assertCanManage(persona: Persona, feature: FeatureKey): void {
  if (!canManage(persona, feature)) {
    throw new PersonaError(
      `persona ${JSON.stringify(persona)} may not manage ` +
        `${feature.manageability} feature ${JSON.stringify(feature.key)}`,
    );
  }
}
```

- [ ] **Step 8: Run the full unit suite**

Run: `npm test -w backend`
Expected: PASS, 37 tests across four files.

- [ ] **Step 9: Commit**

```bash
git add backend/src/model/featureKey.ts backend/src/model/persona.ts \
        backend/test/unit/featureKey.test.ts backend/test/unit/persona.test.ts
git commit -m "feat(model): feature key scheme and persona visibility

The key carries its own classification, so Superposition's default_configs
stay the single source of truth with no sidecar catalog to drift."
```

---

### Task 3: The copy decision

**Files:**
- Create: `backend/src/model/provisioning.ts`
- Test: `backend/test/unit/provisioning.test.ts`

**Interfaces:**
- Consumes: `EntityPath`, `Level`, `levelIndex`, `levelOf`, `parentPath` from `model/hierarchy.js`; `FeatureKey` from `model/featureKey.js`.
- Produces: `CopyPlanItem` (`{ key: string; fromPath: EntityPath }`), `shouldCopy(feature, level)`, `planCopies(features, path)`.

- [ ] **Step 1: Write the failing test**

`backend/test/unit/provisioning.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFeatureKey } from '../../src/model/featureKey.js';
import { planCopies, shouldCopy } from '../../src/model/provisioning.js';

const DEMO = [
  'internal.inherited.decision_engine_rollout',
  'internal.copied.connector_retry_budget',
  'external.inherited.payment_retries_enabled',
  'external.copied_till_merchant.checkout_theme',
].map(parseFeatureKey);

const inherited = DEMO[0]!;
const copiedEverywhere = DEMO[1]!;
const copiedTillMerchant = DEMO[3]!;

describe('shouldCopy', () => {
  it('never copies an inherited feature', () => {
    for (const level of ['org', 'merchant', 'profile'] as const) {
      expect(shouldCopy(inherited, level)).toBe(false);
    }
  });

  it('copies a bare-copied feature at every level', () => {
    expect(shouldCopy(copiedEverywhere, 'org')).toBe(true);
    expect(shouldCopy(copiedEverywhere, 'merchant')).toBe(true);
    expect(shouldCopy(copiedEverywhere, 'profile')).toBe(true);
  });

  // The boundary: ownership starts at the top and stops at `till`.
  it('copies down to the boundary and no further', () => {
    expect(shouldCopy(copiedTillMerchant, 'org')).toBe(true);
    expect(shouldCopy(copiedTillMerchant, 'merchant')).toBe(true);
    expect(shouldCopy(copiedTillMerchant, 'profile')).toBe(false);
  });

  it('copies only at the root for a till-org feature', () => {
    const tillOrg = parseFeatureKey('internal.copied_till_org.x');
    expect(shouldCopy(tillOrg, 'org')).toBe(true);
    expect(shouldCopy(tillOrg, 'merchant')).toBe(false);
    expect(shouldCopy(tillOrg, 'profile')).toBe(false);
  });
});

describe('planCopies', () => {
  it('names the parent to copy from, empty for an org', () => {
    expect(planCopies(DEMO, ['acme'])).toEqual([
      { key: 'internal.copied.connector_retry_budget', fromPath: [] },
      { key: 'external.copied_till_merchant.checkout_theme', fromPath: [] },
    ]);
  });

  it('copies both copied features at merchant level', () => {
    expect(planCopies(DEMO, ['acme', 'm1'])).toEqual([
      { key: 'internal.copied.connector_retry_budget', fromPath: ['acme'] },
      { key: 'external.copied_till_merchant.checkout_theme', fromPath: ['acme'] },
    ]);
  });

  // The demo's central contrast, as a fixture.
  it('copies only the every-level feature at profile level', () => {
    expect(planCopies(DEMO, ['acme', 'm1', 'p1'])).toEqual([
      { key: 'internal.copied.connector_retry_budget', fromPath: ['acme', 'm1'] },
    ]);
  });

  it('plans nothing when no feature is copied', () => {
    expect(planCopies([inherited], ['acme', 'm1'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -w backend -- provisioning`
Expected: FAIL — cannot resolve `../../src/model/provisioning.js`.

- [ ] **Step 3: Implement provisioning.ts**

`backend/src/model/provisioning.ts`:

```ts
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
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npm test -w backend -- provisioning`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/model/provisioning.ts backend/test/unit/provisioning.test.ts
git commit -m "feat(model): copy boundary decision

copied_till_<level> means ownership starts at the top and stops at the
boundary, so an org never silently tracks the workspace default while its
merchants own their values."
```

---

### Task 4: Provenance from the resolution timeline

**Files:**
- Create: `backend/src/model/provenance.ts`
- Test: `backend/test/unit/provenance.test.ts`

**Interfaces:**
- Consumes: `EntityPath`, `conditionToPath`, `samePath` from `model/hierarchy.js`.
- Produces: `TimelineItem`, `Provenance`, `provenanceOf(timeline, path)`, `describeProvenance(provenance)`.

- [ ] **Step 1: Write the failing test**

`backend/test/unit/provenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type TimelineItem, describeProvenance, provenanceOf,
} from '../../src/model/provenance.js';

function step(condition: Record<string, unknown>, before: unknown, after: unknown): TimelineItem {
  return {
    context_id: `ctx-${JSON.stringify(condition)}`,
    condition,
    override_id: 'ovr',
    value_before: before,
    value_after: after,
  };
}

const profile = ['acme', 'm1', 'p1'];

describe('provenanceOf', () => {
  it('reports the platform default for an empty timeline', () => {
    expect(provenanceOf([], profile)).toEqual({ kind: 'default' });
  });

  it('reports own when the last context is the entity itself', () => {
    const timeline = [
      step({ org: 'acme' }, 'classic', 'neo'),
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'neo', 'minimal'),
    ];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'own' });
  });

  it('reports the ancestor when the last context is a proper prefix', () => {
    const timeline = [step({ org: 'acme', merchant: 'm1' }, 'classic', 'neo')];
    expect(provenanceOf(timeline, profile)).toEqual({
      kind: 'inherited', fromPath: ['acme', 'm1'],
    });
  });

  it('reports the org when only the org has a value', () => {
    const timeline = [step({ org: 'acme' }, 'classic', 'neo')];
    expect(provenanceOf(timeline, profile)).toEqual({
      kind: 'inherited', fromPath: ['acme'],
    });
  });

  /**
   * Review-adjacent: the case that rules out inferring provenance by comparing
   * an entity's value to its ancestor's. Right after a copy the two values are
   * EQUAL, so only the condition can distinguish own from inherited.
   */
  it('distinguishes own from inherited when the values are equal', () => {
    const inherited = [step({ org: 'acme', merchant: 'm1' }, 'classic', 'classic')];
    const own = [
      step({ org: 'acme', merchant: 'm1' }, 'classic', 'classic'),
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'classic', 'classic'),
    ];
    expect(provenanceOf(inherited, profile).kind).toBe('inherited');
    expect(provenanceOf(own, profile).kind).toBe('own');
  });

  it('reports a cohort override', () => {
    const timeline = [
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'classic', 'neo'),
      step(
        { org: 'acme', merchant: 'm1', profile: 'p1', customer_cohort: 'gold' },
        'neo', 'minimal',
      ),
    ];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'cohort', cohort: 'gold' });
  });

  it('reports the kill switch, whatever else matched', () => {
    const timeline = [
      step({ org: 'acme', merchant: 'm1', profile: 'p1' }, 'classic', 'neo'),
      step({ killswitch: true }, 'neo', 'classic'),
    ];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'killswitch' });
  });

  it('prefers the kill switch over a cohort in the same condition', () => {
    const timeline = [step({ customer_cohort: 'gold', killswitch: true }, 'a', 'b')];
    expect(provenanceOf(timeline, profile)).toEqual({ kind: 'killswitch' });
  });
});

describe('describeProvenance', () => {
  it('renders each kind for the UI', () => {
    expect(describeProvenance({ kind: 'default' })).toBe('platform default');
    expect(describeProvenance({ kind: 'own' })).toBe('own');
    expect(describeProvenance({ kind: 'inherited', fromPath: ['acme', 'm1'] }))
      .toBe('inherited from acme/m1');
    expect(describeProvenance({ kind: 'cohort', cohort: 'gold' }))
      .toBe('cohort gold');
    expect(describeProvenance({ kind: 'killswitch' })).toBe('kill switch engaged');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -w backend -- provenance`
Expected: FAIL — cannot resolve `../../src/model/provenance.js`.

- [ ] **Step 3: Implement provenance.ts**

`backend/src/model/provenance.ts`:

```ts
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
  }
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npm test -w backend -- provenance`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole unit suite — the model is now complete**

Run: `npm test -w backend`
Expected: PASS, 55 tests across six files, with no Superposition running.

- [ ] **Step 6: Commit**

```bash
git add backend/src/model/provenance.ts backend/test/unit/provenance.test.ts
git commit -m "feat(model): provenance from the resolution timeline

Reads the last applying context's condition, not its value: after a copy an
entity and its parent hold equal values, so value comparison would misreport
own as inherited in the demo's central case."
```

---

### Task 5: Superposition control-plane adapter

**Files:**
- Create: `backend/src/superposition/config.ts`, `backend/src/superposition/client.ts`, `backend/src/superposition/controlPlane.ts`, `backend/src/superposition/workspace.ts`
- Create: `backend/test/helpers/workspace.ts`
- Test: `backend/test/integration/controlPlane.test.ts`

**Interfaces:**
- Consumes: `TimelineItem` from `model/provenance.js`.
- Produces: `SUPERPOSITION` (`{ endpoint, token, orgId, workspaceId, adminEmail }`), `makeClient(overrides?)`, and class `ControlPlane` with methods `listDefaultConfigs()`, `putDefaultConfig(key, value, schema, description)`, `listDimensions()`, `createDimension(spec)`, `getContext(condition)`, `putContext(condition, override, changeReason)`, `deleteContext(id)`, `replaceContextOverrides(condition, overrides, changeReason)`, `listContexts()`, `resolve(context, options?)`, `explain(key, context)`. Also `DefaultConfigRow`, `ContextRow`, `DimensionSpec`. From `superposition/workspace.ts`: `ensureWorkspace(client, orgId, name, adminEmail)`. From `test/helpers/workspace.ts`: `TEST_WORKSPACE`, `deleteAllContexts(controlPlane)`.

**Note:** this is the first task needing Superposition running. Verify with
`curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health` → `200`.
If it is not running, start it: `docker run -p 8080:8080 ghcr.io/juspay/superposition-demo:latest`.

- [ ] **Step 1: Write config.ts and client.ts**

`backend/src/superposition/config.ts`:

```ts
export const SUPERPOSITION = {
  endpoint: process.env['SUPERPOSITION_ENDPOINT'] ?? 'http://localhost:8080',
  /** Local Superposition accepts any token; auth is permissive. */
  token: process.env['SUPERPOSITION_TOKEN'] ?? 'some-token',
  orgId: process.env['SUPERPOSITION_ORG_ID'] ?? 'localorg',
  workspaceId: process.env['SUPERPOSITION_WORKSPACE'] ?? 'featuredemo',
  adminEmail: process.env['SUPERPOSITION_ADMIN_EMAIL'] ?? 'admin@localorg.io',
} as const;

/** Every Superposition write needs one; ours say which part of the demo wrote. */
export const CHANGE_REASON = 'feature-modelling demo';
```

`backend/src/superposition/client.ts`:

```ts
import { SuperpositionClient } from 'superposition-sdk';
import { SUPERPOSITION } from './config.js';

/**
 * The token is a nested object, not a bare string - `{ token: { token: "..." } }`.
 * Passing a string fails at request time with an unhelpful error.
 */
export function makeClient(
  overrides: { endpoint?: string; token?: string } = {},
): SuperpositionClient {
  return new SuperpositionClient({
    endpoint: overrides.endpoint ?? SUPERPOSITION.endpoint,
    token: { token: overrides.token ?? SUPERPOSITION.token },
  });
}
```

- [ ] **Step 2: Write the failing integration test**

`backend/test/integration/controlPlane.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

const KEY = 'external.inherited.cp_probe_value';
let cp: ControlPlane;

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await deleteAllContexts(cp);
  await cp.createDimension({ name: 'org', position: 1, schema: { type: 'string' }, description: 'org' });
  await cp.createDimension({ name: 'merchant', position: 2, schema: { type: 'string' }, description: 'merchant' });
  await cp.putDefaultConfig(KEY, 'alpha', { type: 'string' }, 'control plane probe');
});

afterAll(async () => {
  if (cp) await deleteAllContexts(cp);
});

describe('default configs', () => {
  it('lists the key it just wrote', async () => {
    const rows = await cp.listDefaultConfigs();
    expect(rows.map((r) => r.key)).toContain(KEY);
    expect(rows.find((r) => r.key === KEY)?.value).toBe('alpha');
  });

  it('is idempotent - a second write updates rather than failing', async () => {
    await cp.putDefaultConfig(KEY, 'beta', { type: 'string' }, 'control plane probe');
    const rows = await cp.listDefaultConfigs();
    expect(rows.find((r) => r.key === KEY)?.value).toBe('beta');
    await cp.putDefaultConfig(KEY, 'alpha', { type: 'string' }, 'control plane probe');
  });
});

describe('dimensions', () => {
  it('is idempotent on create', async () => {
    await cp.createDimension({ name: 'org', position: 1, schema: { type: 'string' }, description: 'org' });
    const names = (await cp.listDimensions()).map((d) => d.dimension);
    expect(names).toContain('org');
    expect(names.filter((n) => n === 'org')).toHaveLength(1);
  });
});

describe('contexts', () => {
  it('returns null for a condition with no context', async () => {
    expect(await cp.getContext({ org: 'ghost' })).toBeNull();
  });

  it('creates a context and reads it back', async () => {
    await cp.putContext({ org: 'acme' }, { [KEY]: 'org-value' }, 'test');
    const row = await cp.getContext({ org: 'acme' });
    expect(row).not.toBeNull();
    expect(row!.override[KEY]).toBe('org-value');
  });

  // Spec correction 1: CreateContext merges, so set-a-key is one call.
  it('merges a second key into an existing context rather than replacing it', async () => {
    await cp.putDefaultConfig('external.inherited.cp_probe_other', 'x', { type: 'string' }, 'probe');
    await cp.putContext({ org: 'acme' }, { 'external.inherited.cp_probe_other': 'y' }, 'test');
    const row = await cp.getContext({ org: 'acme' });
    expect(row!.override[KEY]).toBe('org-value');
    expect(row!.override['external.inherited.cp_probe_other']).toBe('y');
  });

  it('overwrites the value of a key already in the context', async () => {
    await cp.putContext({ org: 'acme' }, { [KEY]: 'changed' }, 'test');
    expect((await cp.getContext({ org: 'acme' }))!.override[KEY]).toBe('changed');
  });

  it('shrinks an override set via replaceContextOverrides', async () => {
    await cp.replaceContextOverrides({ org: 'acme' }, { [KEY]: 'only' }, 'test');
    const row = await cp.getContext({ org: 'acme' });
    expect(Object.keys(row!.override)).toEqual([KEY]);
    expect(row!.override[KEY]).toBe('only');
  });

  it('weights a deeper context above a shallower one', async () => {
    await cp.putContext({ org: 'acme', merchant: 'm1' }, { [KEY]: 'merchant-value' }, 'test');
    const org = await cp.getContext({ org: 'acme' });
    const merchant = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(Number(merchant!.weight)).toBeGreaterThan(Number(org!.weight));
  });
});

describe('resolve and explain', () => {
  it('resolves the deepest matching context', async () => {
    const config = await cp.resolve({ org: 'acme', merchant: 'm1' });
    expect(config[KEY]).toBe('merchant-value');
  });

  it('falls back to the org value for a sibling with no context', async () => {
    const config = await cp.resolve({ org: 'acme', merchant: 'm2' });
    expect(config[KEY]).toBe('only');
  });

  it('filters by prefix so excluded keys never arrive', async () => {
    await cp.putDefaultConfig('internal.inherited.cp_probe_secret', 'hidden', { type: 'string' }, 'probe');
    const config = await cp.resolve({ org: 'acme' }, { prefix: ['external.'] });
    expect(Object.keys(config).some((k) => k.startsWith('internal.'))).toBe(false);
    expect(config[KEY]).toBe('only');
  });

  it('explains the cascade as an ordered timeline', async () => {
    const timeline = await cp.explain(KEY, { org: 'acme', merchant: 'm1' });
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0]!.condition).toEqual({ org: 'acme' });
    expect(timeline[timeline.length - 1]!.condition).toEqual({ org: 'acme', merchant: 'm1' });
    expect(timeline[timeline.length - 1]!.value_after).toBe('merchant-value');
  });

  it('returns an empty timeline when only the default applies', async () => {
    expect(await cp.explain(KEY, { org: 'untouched' })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npm run test:integration -w backend -- controlPlane`
Expected: FAIL — cannot resolve `../../src/superposition/controlPlane.js`.

- [ ] **Step 4: Implement the test workspace helper**

`backend/src/superposition/workspace.ts` — used by both the bootstrap script
and the tests, so it lives in `src` rather than under `test/`:

```ts
import { CreateWorkspaceCommand, type SuperpositionClient } from 'superposition-sdk';

/** Create the workspace, or do nothing if it is already there. */
export async function ensureWorkspace(
  client: SuperpositionClient,
  orgId: string,
  name: string,
  adminEmail: string,
): Promise<void> {
  try {
    await client.send(
      new CreateWorkspaceCommand({
        org_id: orgId,
        workspace_name: name,
        workspace_admin_email: adminEmail,
        workspace_status: 'ENABLED',
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Already there from an earlier run; that is the normal path.
    if (!/already exist|duplicate|unique/i.test(message)) throw error;
  }
}
```

`backend/test/helpers/workspace.ts`:

```ts
import type { ControlPlane } from '../../src/superposition/controlPlane.js';

export { ensureWorkspace } from '../../src/superposition/workspace.js';

/**
 * Superposition has no DeleteWorkspace operation, so integration tests cannot
 * drop their workspace. Instead one fixed workspace is reused and cleaned at
 * the START of each run - a crashed run therefore cannot poison the next.
 */
export const TEST_WORKSPACE = 'featuredemo_test';

/**
 * Deleting contexts is enough of a reset: bootstrap is idempotent and rewrites
 * the feature defaults, so dimensions and default configs can stay. Contexts
 * must go first in any case - Superposition refuses to delete a default config
 * key still referenced by a context.
 */
export async function deleteAllContexts(controlPlane: ControlPlane): Promise<void> {
  for (const row of await controlPlane.listContexts()) {
    await controlPlane.deleteContext(row.id);
  }
}
```

- [ ] **Step 5: Implement controlPlane.ts**

`backend/src/superposition/controlPlane.ts`:

```ts
import {
  BulkOperationCommand, CreateContextCommand, CreateDefaultConfigCommand,
  CreateDimensionCommand, DeleteContextCommand, GetContextFromConditionCommand,
  GetResolvedConfigCommand, GetResolvedConfigExplanationCommand,
  ListContextsCommand, ListDefaultConfigsCommand, ListDimensionsCommand,
  type SuperpositionClient, UpdateDefaultConfigCommand,
} from 'superposition-sdk';
import { CHANGE_REASON } from './config.js';
import type { TimelineItem } from '../model/provenance.js';

export interface DefaultConfigRow {
  key: string;
  value: unknown;
  schema: Record<string, unknown>;
  description: string;
}

export interface ContextRow {
  id: string;
  condition: Record<string, unknown>;
  override: Record<string, unknown>;
  /** Superposition returns this as a string; compare numerically. */
  weight: string;
}

export interface DimensionSpec {
  name: string;
  position: number;
  schema: Record<string, unknown>;
  description: string;
  /** Omit for a regular dimension; set to the parent name for a local cohort. */
  localCohortOf?: string;
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not ?found/i.test(message);
}

function isAlreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exist|duplicate|unique/i.test(message);
}

export class ControlPlane {
  constructor(
    private readonly client: SuperpositionClient,
    private readonly orgId: string,
    private readonly workspaceId: string,
  ) {}

  private get base() {
    return { org_id: this.orgId, workspace_id: this.workspaceId };
  }

  async listDefaultConfigs(): Promise<DefaultConfigRow[]> {
    const response = await this.client.send(
      new ListDefaultConfigsCommand({ ...this.base, all: true }),
    );
    return (response.data ?? []).map((row) => ({
      key: row.key!,
      value: row.value,
      schema: (row.schema ?? {}) as Record<string, unknown>,
      description: row.description ?? '',
    }));
  }

  /** Create, or update if the key is already there. Makes bootstrap a reset. */
  async putDefaultConfig(
    key: string,
    value: unknown,
    schema: Record<string, unknown>,
    description: string,
  ): Promise<void> {
    const input = {
      ...this.base, key, value, schema, description, change_reason: CHANGE_REASON,
    };
    try {
      await this.client.send(new CreateDefaultConfigCommand(input));
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await this.client.send(new UpdateDefaultConfigCommand(input));
    }
  }

  async listDimensions(): Promise<{ dimension: string; position: number }[]> {
    const response = await this.client.send(
      new ListDimensionsCommand({ ...this.base, all: true }),
    );
    return (response.data ?? []).map((row) => ({
      dimension: row.dimension!,
      position: row.position!,
    }));
  }

  /** Idempotent: an existing dimension is left as it is. */
  async createDimension(spec: DimensionSpec): Promise<void> {
    try {
      await this.client.send(
        new CreateDimensionCommand({
          ...this.base,
          dimension: spec.name,
          position: spec.position,
          schema: spec.schema,
          description: spec.description,
          change_reason: CHANGE_REASON,
          dimension_type: spec.localCohortOf
            ? { LOCAL_COHORT: spec.localCohortOf }
            : { REGULAR: {} },
        }),
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  async getContext(condition: Record<string, unknown>): Promise<ContextRow | null> {
    try {
      const response = await this.client.send(
        new GetContextFromConditionCommand({ ...this.base, context: condition }),
      );
      return {
        id: response.id!,
        condition: (response.value ?? {}) as Record<string, unknown>,
        override: (response.override ?? {}) as Record<string, unknown>,
        weight: String(response.weight ?? '0'),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listContexts(): Promise<ContextRow[]> {
    const response = await this.client.send(
      new ListContextsCommand({ ...this.base, all: true }),
    );
    return (response.data ?? []).map((row) => ({
      id: row.id!,
      condition: (row.value ?? {}) as Record<string, unknown>,
      override: (row.override ?? {}) as Record<string, unknown>,
      weight: String(row.weight ?? '0'),
    }));
  }

  /**
   * Create the context, or merge these overrides into it if the condition
   * already has one. CreateContext is idempotent and merges on conflict, so
   * this single call is both "create" and "set a key".
   */
  async putContext(
    condition: Record<string, unknown>,
    override: Record<string, unknown>,
    changeReason = CHANGE_REASON,
  ): Promise<void> {
    await this.client.send(
      new CreateContextCommand({
        ...this.base,
        request: { context: condition, override, change_reason: changeReason },
      }),
    );
  }

  async deleteContext(id: string): Promise<void> {
    await this.client.send(new DeleteContextCommand({ ...this.base, id }));
  }

  /**
   * Set a context's overrides to exactly `overrides`, dropping any key not
   * listed. Needed because both CreateContext and UpdateOverride MERGE, so
   * neither can remove a key. Done as one atomic BulkOperation: DELETE then
   * PUT. Passing an empty `overrides` deletes the context outright, since a
   * context with no overrides is not a thing Superposition stores.
   */
  async replaceContextOverrides(
    condition: Record<string, unknown>,
    overrides: Record<string, unknown>,
    changeReason = CHANGE_REASON,
  ): Promise<void> {
    const existing = await this.getContext(condition);
    if (!existing) {
      if (Object.keys(overrides).length > 0) {
        await this.putContext(condition, overrides, changeReason);
      }
      return;
    }

    if (Object.keys(overrides).length === 0) {
      await this.deleteContext(existing.id);
      return;
    }

    await this.client.send(
      new BulkOperationCommand({
        ...this.base,
        operations: [
          { DELETE: existing.id },
          {
            PUT: { context: condition, override: overrides, change_reason: changeReason },
          },
        ],
      }),
    );
  }

  /** Authoritative, uncached resolution. Used for provisioning and management reads. */
  async resolve(
    context: Record<string, unknown>,
    options: { prefix?: string[] } = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.client.send(
      new GetResolvedConfigCommand({
        ...this.base,
        context,
        ...(options.prefix ? { prefix: options.prefix } : {}),
      }),
    );
    return (response.config ?? {}) as Record<string, unknown>;
  }

  /** The ordered contexts that shaped one key's value, for provenance and the probe. */
  async explain(
    key: string,
    context: Record<string, unknown>,
  ): Promise<TimelineItem[]> {
    const response = await this.client.send(
      new GetResolvedConfigExplanationCommand({ ...this.base, key, context }),
    );
    const timeline = response.explanation?.timeline ?? [];
    return timeline.map((item) => ({
      context_id: item.context_id!,
      condition: (item.condition ?? {}) as Record<string, unknown>,
      override_id: item.override_id!,
      value_before: item.value_before,
      value_after: item.value_after,
    }));
  }
}
```

- [ ] **Step 6: Run the integration test**

Run: `npm run test:integration -w backend -- controlPlane`
Expected: PASS, 13 tests.

If `listDefaultConfigs` or `listDimensions` rejects `all: true`, drop that
field and pass `count: 100, page: 1` instead — the list operations are
paginated and the exact flag name is the one place the SDK surface was not
verified ahead of time.

- [ ] **Step 7: Settle the open question on REPLACE**

The spec records one open question: whether `ContextAction.REPLACE` shrinks an
override set in one action, which would remove the DELETE+PUT pair. Add this test:

```ts
it('records whether REPLACE shrinks an override set in one action', async () => {
  await cp.putContext({ org: 'replaceprobe' }, { [KEY]: 'a' }, 'test');
  await cp.putDefaultConfig('external.inherited.cp_probe_second', 's', { type: 'string' }, 'probe');
  await cp.putContext({ org: 'replaceprobe' }, { 'external.inherited.cp_probe_second': 's' }, 'test');

  const before = await cp.getContext({ org: 'replaceprobe' });
  expect(Object.keys(before!.override)).toHaveLength(2);

  await cp.replaceContextOverrides({ org: 'replaceprobe' }, { [KEY]: 'a' }, 'test');
  const after = await cp.getContext({ org: 'replaceprobe' });
  expect(Object.keys(after!.override)).toEqual([KEY]);
});
```

Run: `npm run test:integration -w backend -- controlPlane`
Expected: PASS. Then note the finding in the spec's "Open implementation
details" section — replace item 1 with one sentence saying DELETE+PUT is
confirmed working, so no further change is needed.

- [ ] **Step 8: Commit**

```bash
git add backend/src/superposition/ backend/test/helpers/ backend/test/integration/
git commit -m "feat(superposition): control-plane adapter

CreateContext merges on an existing condition, so setting a key is one call;
shrinking an override set needs an atomic DELETE+PUT because no single
operation can remove a key."
```

---

### Task 6: Bootstrap the workspace

**Files:**
- Create: `backend/src/superposition/schema.ts`, `backend/scripts/bootstrap.ts`
- Test: `backend/test/integration/bootstrap.test.ts`

**Interfaces:**
- Consumes: `ControlPlane`, `DimensionSpec` from `superposition/controlPlane.js`; `DIMENSION_POSITIONS` from `model/dimensions.js`.
- Produces: `DIMENSION_SPECS`, `FEATURE_DEFAULTS`, `COHORTS`, `bootstrap(controlPlane)`.

- [ ] **Step 1: Write the failing test**

`backend/test/integration/bootstrap.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { DIMENSION_SPECS, FEATURE_DEFAULTS, bootstrap } from '../../src/superposition/schema.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

let cp: ControlPlane;

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await deleteAllContexts(cp);
  await bootstrap(cp);
});

describe('bootstrap', () => {
  it('creates every dimension at its specified position', async () => {
    const byName = new Map((await cp.listDimensions()).map((d) => [d.dimension, d.position]));
    for (const spec of DIMENSION_SPECS) {
      expect(byName.get(spec.name)).toBe(spec.position);
    }
  });

  it('keeps the cohort at or below its parent dimension', async () => {
    const byName = new Map((await cp.listDimensions()).map((d) => [d.dimension, d.position]));
    expect(byName.get('customer_cohort')!).toBeLessThanOrEqual(byName.get('customer_id')!);
  });

  it('creates all four demo features with their defaults', async () => {
    const byKey = new Map((await cp.listDefaultConfigs()).map((r) => [r.key, r.value]));
    for (const feature of FEATURE_DEFAULTS) {
      expect(byKey.get(feature.key)).toEqual(feature.value);
    }
    expect(FEATURE_DEFAULTS).toHaveLength(4);
  });

  it('covers all four quadrants exactly once', async () => {
    const quadrants = FEATURE_DEFAULTS.map((f) => {
      const [manageability, propagation] = f.key.split('.');
      return `${manageability}/${propagation!.startsWith('copied') ? 'copied' : 'inherited'}`;
    });
    expect(new Set(quadrants).size).toBe(4);
  });

  it('is idempotent and resets values a run may have changed', async () => {
    const theme = 'external.copied_till_merchant.checkout_theme';
    await cp.putDefaultConfig(theme, 'neo', { type: 'string', enum: ['classic', 'neo', 'minimal'] }, 'drift');
    await bootstrap(cp);
    const byKey = new Map((await cp.listDefaultConfigs()).map((r) => [r.key, r.value]));
    expect(byKey.get(theme)).toBe('classic');
  });

  it('resolves every feature to its default for an unknown entity', async () => {
    const config = await cp.resolve({ org: 'nobody', killswitch: false });
    for (const feature of FEATURE_DEFAULTS) {
      expect(config[feature.key]).toEqual(feature.value);
    }
  });

  it('evaluates the local cohort from a customer id', async () => {
    const gold = await cp.resolve({ org: 'nobody', customer_id: 'cust_001', killswitch: false });
    expect(gold).toBeTruthy();
    // The cohort itself is a dimension, not a config key; its effect is proven
    // in Task 9 where a cohort override is written. Here we only assert that a
    // query carrying customer_id resolves without error, which is what fails
    // when a local cohort's JSONLogic is malformed.
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -w backend -- bootstrap`
Expected: FAIL — cannot resolve `../../src/superposition/schema.js`.

- [ ] **Step 3: Implement schema.ts**

`backend/src/superposition/schema.ts`:

```ts
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
 */
export async function bootstrap(controlPlane: ControlPlane): Promise<void> {
  for (const spec of DIMENSION_SPECS) {
    await controlPlane.createDimension(spec);
  }
  for (const feature of FEATURE_DEFAULTS) {
    await controlPlane.putDefaultConfig(
      feature.key, feature.value, feature.schema, feature.description,
    );
  }
}
```

- [ ] **Step 4: Implement the bootstrap script**

`backend/scripts/bootstrap.ts`:

```ts
import { makeClient } from '../src/superposition/client.js';
import { SUPERPOSITION } from '../src/superposition/config.js';
import { ControlPlane } from '../src/superposition/controlPlane.js';
import { DIMENSION_SPECS, FEATURE_DEFAULTS, bootstrap } from '../src/superposition/schema.js';
import { ensureWorkspace } from '../src/superposition/workspace.js';

const client = makeClient();
await ensureWorkspace(
  client, SUPERPOSITION.orgId, SUPERPOSITION.workspaceId, SUPERPOSITION.adminEmail,
);
const controlPlane = new ControlPlane(client, SUPERPOSITION.orgId, SUPERPOSITION.workspaceId);
await bootstrap(controlPlane);

console.log(`workspace ${SUPERPOSITION.orgId}/${SUPERPOSITION.workspaceId} ready`);
console.log(`  ${DIMENSION_SPECS.length} dimensions, ${FEATURE_DEFAULTS.length} features`);
for (const feature of FEATURE_DEFAULTS) {
  console.log(`  ${feature.key} = ${JSON.stringify(feature.value)}`);
}
```

- [ ] **Step 5: Run the integration test, then bootstrap the real workspace**

Run: `npm run test:integration -w backend -- bootstrap`
Expected: PASS, 7 tests.

Run: `npm run bootstrap`
Expected: prints `workspace localorg/featuredemo ready`, 6 dimensions, 4 features.
Verify in the admin UI at http://localhost:8080 that workspace `featuredemo`
lists the four keys and six dimensions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/superposition/schema.ts backend/scripts/bootstrap.ts \
        backend/test/integration/bootstrap.test.ts
git commit -m "feat(superposition): idempotent workspace bootstrap

Dimensions before default configs, and feature defaults are rewritten every
run so bootstrap doubles as the demo's reset button."
```

---

### Task 7: Feature catalog and entity registry

**Files:**
- Create: `backend/src/catalog.ts`, `backend/src/entities.ts`
- Test: `backend/test/unit/catalog.test.ts`, `backend/test/unit/entities.test.ts`

**Interfaces:**
- Consumes: `FeatureKey`, `tryParseFeatureKey` from `model/featureKey.js`; `DefaultConfigRow` from `superposition/controlPlane.js`; `EntityPath`, `validateEntityId`, `levelOf`, `parentPath`, `encodePath` from `model/hierarchy.js`; `Persona`, `canManage` from `model/persona.js`.
- Produces: `CatalogEntry` (`{ feature: FeatureKey; value: unknown; schema: Record<string, unknown>; description: string }`), `buildCatalog(rows, warn?)`, `visibleCatalog(catalog, persona)`; and from `entities.ts`: `Entity` (`{ id, name, path, level, provisioningState }`), `EntityStore` with `all()`, `get(path)`, `exists(path)`, `children(path)`, `add(entity)`, `setState(path, state)`, `tree()`.

- [ ] **Step 1: Write the failing catalog test**

`backend/test/unit/catalog.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildCatalog, visibleCatalog } from '../../src/catalog.js';

const rows = [
  { key: 'internal.inherited.decision_engine_rollout', value: 'off', schema: { type: 'string' }, description: 'a' },
  { key: 'internal.copied.connector_retry_budget', value: 3, schema: { type: 'integer' }, description: 'b' },
  { key: 'external.inherited.payment_retries_enabled', value: true, schema: { type: 'boolean' }, description: 'c' },
  { key: 'external.copied_till_merchant.checkout_theme', value: 'classic', schema: { type: 'string' }, description: 'd' },
];

describe('buildCatalog', () => {
  it('parses every well-formed key and keeps its value and schema', () => {
    const catalog = buildCatalog(rows);
    expect(catalog).toHaveLength(4);
    const theme = catalog.find((e) => e.feature.name === 'checkout_theme')!;
    expect(theme.feature.manageability).toBe('external');
    expect(theme.feature.propagation).toEqual({ kind: 'copied', till: 'merchant' });
    expect(theme.value).toBe('classic');
    expect(theme.schema).toEqual({ type: 'string' });
  });

  it('sorts by key so the UI order is stable', () => {
    const keys = buildCatalog([...rows].reverse()).map((e) => e.feature.key);
    expect(keys).toEqual([...keys].sort());
  });

  /**
   * Review Focus 4: someone adds a key by hand in the admin UI. The catalog
   * must skip it with a warning rather than throwing, or one stray key takes
   * every feature page down.
   */
  it('skips a key that does not follow the scheme and warns', () => {
    const warn = vi.fn();
    const catalog = buildCatalog(
      [...rows, { key: 'stray_key', value: 1, schema: {}, description: '' }],
      warn,
    );
    expect(catalog).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('stray_key');
  });

  it('skips a key with a known manageability but a bad propagation', () => {
    const warn = vi.fn();
    const catalog = buildCatalog(
      [...rows, { key: 'internal.sometimes.thing', value: 1, schema: {}, description: '' }],
      warn,
    );
    expect(catalog).toHaveLength(4);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('returns an empty catalog for no rows', () => {
    expect(buildCatalog([])).toEqual([]);
  });
});

describe('visibleCatalog', () => {
  it('shows an operator everything', () => {
    expect(visibleCatalog(buildCatalog(rows), 'operator')).toHaveLength(4);
  });

  it('shows a customer only external features', () => {
    const visible = visibleCatalog(buildCatalog(rows), 'customer');
    expect(visible).toHaveLength(2);
    expect(visible.every((e) => e.feature.manageability === 'external')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -w backend -- catalog`
Expected: FAIL — cannot resolve `../../src/catalog.js`.

- [ ] **Step 3: Implement catalog.ts**

`backend/src/catalog.ts`:

```ts
import { type FeatureKey, tryParseFeatureKey } from './model/featureKey.js';
import { type Persona, canManage } from './model/persona.js';
import type { DefaultConfigRow } from './superposition/controlPlane.js';

export interface CatalogEntry {
  feature: FeatureKey;
  /** The workspace default, before any context applies. */
  value: unknown;
  schema: Record<string, unknown>;
  description: string;
}

/**
 * The catalog is derived from Superposition's default_configs, so there is no
 * sidecar file to drift out of sync with the keys that actually exist.
 *
 * A row whose key does not follow the scheme is skipped, not fatal: the admin
 * UI lets anyone add a key, and one stray row must not take the feature pages
 * down.
 */
export function buildCatalog(
  rows: readonly DefaultConfigRow[],
  warn: (message: string) => void = (message) => console.warn(message),
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const row of rows) {
    const feature = tryParseFeatureKey(row.key);
    if (!feature) {
      warn(
        `skipping default config ${JSON.stringify(row.key)}: not of the form ` +
          `<manageability>.<propagation>.<name>`,
      );
      continue;
    }
    entries.push({
      feature,
      value: row.value,
      schema: row.schema,
      description: row.description,
    });
  }
  return entries.sort((a, b) => a.feature.key.localeCompare(b.feature.key));
}

export function visibleCatalog(
  catalog: readonly CatalogEntry[],
  persona: Persona,
): CatalogEntry[] {
  return catalog.filter((entry) => canManage(persona, entry.feature));
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npm test -w backend -- catalog`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing entities test**

`backend/test/unit/entities.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/entities.js';

function freshStore(): EntityStore {
  return new EntityStore(join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json'));
}

let store: EntityStore;
beforeEach(() => {
  store = freshStore();
});

describe('EntityStore', () => {
  it('starts empty', () => {
    expect(store.all()).toEqual([]);
    expect(store.tree()).toEqual([]);
  });

  it('adds an org and finds it by path', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    expect(store.exists(['acme'])).toBe(true);
    expect(store.get(['acme'])?.level).toBe('org');
    expect(store.get(['acme'])?.provisioningState).toBe('ok');
  });

  it('lists children of a path, not grandchildren', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.add({ id: 'm1', name: 'M1', path: ['acme', 'm1'] });
    store.add({ id: 'm2', name: 'M2', path: ['acme', 'm2'] });
    store.add({ id: 'p1', name: 'P1', path: ['acme', 'm1', 'p1'] });

    expect(store.children(['acme']).map((e) => e.id).sort()).toEqual(['m1', 'm2']);
    expect(store.children(['acme', 'm1']).map((e) => e.id)).toEqual(['p1']);
    expect(store.children(['acme', 'm2'])).toEqual([]);
  });

  it('lists roots as the children of the empty path', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.add({ id: 'globex', name: 'Globex', path: ['globex'] });
    expect(store.children([]).map((e) => e.id).sort()).toEqual(['acme', 'globex']);
  });

  it('records a provisioning failure and lets it be cleared', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.setState(['acme'], 'provisioning_failed');
    expect(store.get(['acme'])?.provisioningState).toBe('provisioning_failed');
    store.setState(['acme'], 'ok');
    expect(store.get(['acme'])?.provisioningState).toBe('ok');
  });

  it('persists across instances sharing a file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json');
    const first = new EntityStore(path);
    first.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    expect(new EntityStore(path).get(['acme'])?.name).toBe('Acme');
  });

  it('builds a nested tree', () => {
    store.add({ id: 'acme', name: 'Acme', path: ['acme'] });
    store.add({ id: 'm1', name: 'M1', path: ['acme', 'm1'] });
    store.add({ id: 'p1', name: 'P1', path: ['acme', 'm1', 'p1'] });

    const tree = store.tree();
    expect(tree).toHaveLength(1);
    expect(tree[0]!.entity.id).toBe('acme');
    expect(tree[0]!.children[0]!.entity.id).toBe('m1');
    expect(tree[0]!.children[0]!.children[0]!.entity.id).toBe('p1');
    expect(tree[0]!.children[0]!.children[0]!.children).toEqual([]);
  });

  // Review Focus 1, at the store boundary.
  it('rejects an id carrying a separator or dot', () => {
    expect(() => store.add({ id: 'ac~me', name: 'x', path: ['ac~me'] })).toThrow();
    expect(() => store.add({ id: 'ac.me', name: 'x', path: ['ac.me'] })).toThrow();
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `npm test -w backend -- entities`
Expected: FAIL — cannot resolve `../../src/entities.js`.

- [ ] **Step 7: Implement entities.ts**

`backend/src/entities.ts`:

```ts
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
```

- [ ] **Step 8: Run the full unit suite**

Run: `npm test -w backend`
Expected: PASS, 70 tests across eight files.

- [ ] **Step 9: Commit**

```bash
git add backend/src/catalog.ts backend/src/entities.ts \
        backend/test/unit/catalog.test.ts backend/test/unit/entities.test.ts
git commit -m "feat: feature catalog and entity registry

The catalog is derived from default_configs so nothing can drift; an
unparseable key is skipped with a warning rather than taking the page down."
```

---

### Task 8: Entity provisioning — materializing copies

**Files:**
- Create: `backend/src/provisioner.ts`
- Test: `backend/test/integration/provisioner.test.ts`

**Interfaces:**
- Consumes: `ControlPlane`; `EntityStore`; `buildCatalog`; `planCopies` from `model/provisioning.js`; `pathToCondition`, `parentPath`, `validateEntityId`, `levelOf`, `encodePath` from `model/hierarchy.js`.
- Produces: `ProvisionError`, `CreateEntityResult` (`{ entity: Entity; copied: CopyReport[]; skipped: SkipReport[] }`), `CopyReport` (`{ key: string; value: unknown; fromPath: EntityPath }`), `SkipReport` (`{ key: string; reason: string }`), class `Provisioner` with `createEntity({ path, name })` and `retry(path)`.

- [ ] **Step 1: Write the failing test**

`backend/test/integration/provisioner.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/entities.js';
import { Provisioner } from '../../src/provisioner.js';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { bootstrap } from '../../src/superposition/schema.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

const ROLLOUT = 'internal.inherited.decision_engine_rollout';
const BUDGET = 'internal.copied.connector_retry_budget';
const RETRIES = 'external.inherited.payment_retries_enabled';
const THEME = 'external.copied_till_merchant.checkout_theme';

let cp: ControlPlane;
let store: EntityStore;
let provisioner: Provisioner;

/** A read as the application would do it, without the kill switch engaged. */
const read = (path: string[]) =>
  cp.resolve({ ...pathCondition(path), killswitch: false });

function pathCondition(path: string[]): Record<string, string> {
  const levels = ['org', 'merchant', 'profile'];
  return Object.fromEntries(path.map((id, i) => [levels[i]!, id]));
}

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await bootstrap(cp);
});

beforeEach(async () => {
  await deleteAllContexts(cp);
  await bootstrap(cp);
  store = new EntityStore(join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json'));
  provisioner = new Provisioner(cp, store);
});

describe('copy materialization', () => {
  it('freezes both copied features for a new org, from the workspace default', async () => {
    const result = await provisioner.createEntity({ path: ['acme'], name: 'Acme' });

    expect(result.copied.map((c) => c.key).sort()).toEqual([THEME, BUDGET].sort());
    expect(result.copied.find((c) => c.key === BUDGET)?.value).toBe(3);
    expect(result.copied.find((c) => c.key === THEME)?.value).toBe('classic');

    const context = await cp.getContext({ org: 'acme' });
    expect(Object.keys(context!.override).sort()).toEqual([THEME, BUDGET].sort());
  });

  it('writes nothing for inherited features', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    const context = await cp.getContext({ org: 'acme' });
    expect(context!.override).not.toHaveProperty(ROLLOUT);
    expect(context!.override).not.toHaveProperty(RETRIES);
  });

  it('copies only the every-level feature at profile, and reports the skip', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    const result = await provisioner.createEntity({ path: ['acme', 'm1', 'p1'], name: 'P1' });

    expect(result.copied.map((c) => c.key)).toEqual([BUDGET]);
    expect(result.skipped.map((s) => s.key)).toContain(THEME);

    const context = await cp.getContext({ org: 'acme', merchant: 'm1', profile: 'p1' });
    expect(Object.keys(context!.override)).toEqual([BUDGET]);
  });

  it('copies the parent value, not the workspace default', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await cp.putContext({ org: 'acme' }, { [BUDGET]: 7 }, 'operator edit');
    const result = await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    expect(result.copied.find((c) => c.key === BUDGET)?.value).toBe(7);
  });
});

describe('the behaviors the model claims', () => {
  beforeEach(async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    await provisioner.createEntity({ path: ['acme', 'm1', 'p1'], name: 'P1' });
  });

  it('moves inherited features for every descendant when the org changes', async () => {
    await cp.putContext({ org: 'acme' }, { [ROLLOUT]: 'shadow', [RETRIES]: false }, 'org edit');

    for (const path of [['acme'], ['acme', 'm1'], ['acme', 'm1', 'p1']]) {
      const config = await read(path);
      expect(config[ROLLOUT]).toBe('shadow');
      expect(config[RETRIES]).toBe(false);
    }
  });

  it('moves no copied feature when the org changes', async () => {
    await cp.putContext({ org: 'acme' }, { [BUDGET]: 9, [THEME]: 'neo' }, 'org edit');

    const merchant = await read(['acme', 'm1']);
    expect(merchant[BUDGET]).toBe(3);
    expect(merchant[THEME]).toBe('classic');
  });

  /**
   * The boundary, demonstrated: editing a merchant reaches its profiles for the
   * till-merchant feature (they inherit the merchant's copy) but not for the
   * every-level feature (they own theirs).
   */
  it('reaches profiles for a till-merchant copy but not an every-level copy', async () => {
    await cp.putContext(
      { org: 'acme', merchant: 'm1' }, { [BUDGET]: 8, [THEME]: 'minimal' }, 'merchant edit',
    );

    const profile = await read(['acme', 'm1', 'p1']);
    expect(profile[THEME]).toBe('minimal');
    expect(profile[BUDGET]).toBe(3);
  });

  it('leaves a sibling with no override on the parent value', async () => {
    await cp.putContext({ org: 'acme' }, { [ROLLOUT]: 'primary' }, 'org edit');
    const sibling = await read(['acme', 'm2']);
    expect(sibling[ROLLOUT]).toBe('primary');
  });

  it('does not move an existing org when the workspace default changes', async () => {
    await cp.putDefaultConfig(
      BUDGET, 1, { type: 'integer', minimum: 0, maximum: 10 }, 'platform change',
    );
    expect((await read(['acme']))[BUDGET]).toBe(3);
  });
});

describe('rejected creations', () => {
  // Review Focus 3
  it('rejects an entity whose parent does not exist, writing nothing', async () => {
    await expect(
      provisioner.createEntity({ path: ['ghost', 'm1'], name: 'M1' }),
    ).rejects.toThrow(/parent/i);
    expect(await cp.getContext({ org: 'ghost', merchant: 'm1' })).toBeNull();
    expect(store.exists(['ghost', 'm1'])).toBe(false);
  });

  // Review Focus 2 - the dangerous one: CreateContext merges, so without this
  // guard a duplicate create would overwrite the existing entity's frozen copies.
  it('rejects a duplicate entity without touching its existing copies', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await cp.putContext({ org: 'acme' }, { [BUDGET]: 7 }, 'operator edit');

    await expect(
      provisioner.createEntity({ path: ['acme'], name: 'Acme Again' }),
    ).rejects.toThrow(/exists/i);

    expect((await cp.getContext({ org: 'acme' }))!.override[BUDGET]).toBe(7);
  });

  // Review Focus 1
  it('rejects an id carrying a separator or a dot before writing anything', async () => {
    await expect(
      provisioner.createEntity({ path: ['ac~me'], name: 'Bad' }),
    ).rejects.toThrow(/~/);
    await expect(
      provisioner.createEntity({ path: ['ac.me'], name: 'Bad' }),
    ).rejects.toThrow();
    expect(store.all()).toEqual([]);
  });

  it('rejects a path deeper than the hierarchy', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    await provisioner.createEntity({ path: ['acme', 'm1'], name: 'M1' });
    await provisioner.createEntity({ path: ['acme', 'm1', 'p1'], name: 'P1' });
    await expect(
      provisioner.createEntity({ path: ['acme', 'm1', 'p1', 'x'], name: 'X' }),
    ).rejects.toThrow();
  });
});

describe('retry', () => {
  it('is idempotent - re-running leaves the same copies', async () => {
    await provisioner.createEntity({ path: ['acme'], name: 'Acme' });
    const before = await cp.getContext({ org: 'acme' });
    store.setState(['acme'], 'provisioning_failed');

    await provisioner.retry(['acme']);

    const after = await cp.getContext({ org: 'acme' });
    expect(after!.override).toEqual(before!.override);
    expect(store.get(['acme'])?.provisioningState).toBe('ok');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -w backend -- provisioner`
Expected: FAIL — cannot resolve `../../src/provisioner.js`.

- [ ] **Step 3: Implement provisioner.ts**

`backend/src/provisioner.ts`:

```ts
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
    const level = levelOf(path); // throws if deeper than the hierarchy

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
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -w backend -- provisioner`
Expected: PASS, 15 tests. These are the spec's behavioral claims; if any fail,
the model is wrong, not the test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/provisioner.ts backend/test/integration/provisioner.test.ts
git commit -m "feat: entity provisioning with copy materialization

Validates before writing so a rejected create leaves no orphan context, and
rejects duplicates because CreateContext's merge would otherwise overwrite an
entity's frozen copies with freshly resolved ones."
```

---

### Task 9: Feature operations — set, revert, cohort, kill switch

**Files:**
- Create: `backend/src/features.ts`
- Test: `backend/test/integration/features.test.ts`

**Interfaces:**
- Consumes: `ControlPlane`; `buildCatalog`, `visibleCatalog`, `CatalogEntry`; `parseFeatureKey`; `Persona`, `assertCanManage`; `provenanceOf`, `describeProvenance`, `TimelineItem`; `resolvePrefixes`; `pathToCondition`.
- Produces: `FeatureError`, `FeatureView` (`{ feature: FeatureKey; schema; description; value: unknown; provenance: Provenance; provenanceLabel: string; editable: boolean }`), class `FeatureService` with `catalog(persona)`, `viewFor(path, persona)`, `explain(path, key)`, `setValue(path, key, value, persona)`, `revert(path, key, persona)`, `setCohortValue(path, cohort, key, value, persona)`, `engageKillSwitch(key, value, persona)`, `disengageKillSwitch(key, persona)`, `resolveAs(path, customerId, persona)`.

- [ ] **Step 1: Write the failing test**

`backend/test/integration/features.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/entities.js';
import { FeatureService } from '../../src/features.js';
import { Provisioner } from '../../src/provisioner.js';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { bootstrap } from '../../src/superposition/schema.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

const ROLLOUT = 'internal.inherited.decision_engine_rollout';
const BUDGET = 'internal.copied.connector_retry_budget';
const RETRIES = 'external.inherited.payment_retries_enabled';
const THEME = 'external.copied_till_merchant.checkout_theme';

const ACME = ['acme'];
const M1 = ['acme', 'm1'];
const P1 = ['acme', 'm1', 'p1'];

let cp: ControlPlane;
let features: FeatureService;

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await bootstrap(cp);
});

beforeEach(async () => {
  await deleteAllContexts(cp);
  await bootstrap(cp);
  const store = new EntityStore(join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json'));
  const provisioner = new Provisioner(cp, store);
  await provisioner.createEntity({ path: ACME, name: 'Acme' });
  await provisioner.createEntity({ path: M1, name: 'M1' });
  await provisioner.createEntity({ path: P1, name: 'P1' });
  features = new FeatureService(cp);
});

describe('viewFor', () => {
  it('reports provenance per feature', async () => {
    const view = await features.viewFor(M1, 'operator');
    const byKey = new Map(view.map((v) => [v.feature.key, v]));

    expect(byKey.get(ROLLOUT)!.provenance.kind).toBe('default');
    expect(byKey.get(BUDGET)!.provenance.kind).toBe('own');
    expect(byKey.get(THEME)!.provenance.kind).toBe('own');
  });

  it('calls a profile value inherited for a till-merchant feature', async () => {
    const byKey = new Map((await features.viewFor(P1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(THEME)!.provenance).toEqual({ kind: 'inherited', fromPath: M1 });
    expect(byKey.get(THEME)!.provenanceLabel).toBe('inherited from acme/m1');
    expect(byKey.get(BUDGET)!.provenance.kind).toBe('own');
  });

  it('distinguishes own from inherited although the values are equal', async () => {
    const byKey = new Map((await features.viewFor(P1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(THEME)!.value).toBe('classic');
    expect(byKey.get(BUDGET)!.value).toBe(3);
    expect(byKey.get(THEME)!.provenance.kind).not.toBe(byKey.get(BUDGET)!.provenance.kind);
  });

  it('hides internal features from a customer entirely', async () => {
    const view = await features.viewFor(M1, 'customer');
    expect(view.map((v) => v.feature.key).sort()).toEqual([THEME, RETRIES].sort());
    expect(view.every((v) => v.feature.manageability === 'external')).toBe(true);
  });
});

describe('setValue', () => {
  it('sets an own override and reports it as own', async () => {
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    const byKey = new Map((await features.viewFor(M1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(ROLLOUT)!.value).toBe('shadow');
    expect(byKey.get(ROLLOUT)!.provenance.kind).toBe('own');
  });

  it('leaves the other keys in the context alone', async () => {
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    const context = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(context!.override[BUDGET]).toBe(3);
    expect(context!.override[THEME]).toBe('classic');
    expect(context!.override[ROLLOUT]).toBe('shadow');
  });

  it('refuses a customer setting an internal feature', async () => {
    await expect(features.setValue(M1, ROLLOUT, 'shadow', 'customer'))
      .rejects.toThrow(/may not manage/);
    const context = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(context!.override).not.toHaveProperty(ROLLOUT);
  });

  /**
   * Review Focus 5: Superposition validates against the key's schema. Surface
   * its message rather than a generic one, and write nothing.
   */
  it('surfaces a schema violation and writes nothing', async () => {
    await expect(features.setValue(M1, BUDGET, 99, 'operator')).rejects.toThrow();
    expect((await cp.getContext({ org: 'acme', merchant: 'm1' }))!.override[BUDGET]).toBe(3);
  });

  it('rejects an off-enum value', async () => {
    await expect(features.setValue(M1, THEME, 'neon', 'operator')).rejects.toThrow();
    expect((await cp.getContext({ org: 'acme', merchant: 'm1' }))!.override[THEME]).toBe('classic');
  });

  it('rejects a key that is not in the catalog', async () => {
    await expect(features.setValue(M1, 'external.inherited.nope', true, 'operator'))
      .rejects.toThrow(/not a known feature/);
  });
});

describe('revert', () => {
  it('removes one key and preserves the rest of the context', async () => {
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    await features.revert(M1, ROLLOUT, 'operator');

    const context = await cp.getContext({ org: 'acme', merchant: 'm1' });
    expect(context!.override).not.toHaveProperty(ROLLOUT);
    expect(context!.override[BUDGET]).toBe(3);
    expect(context!.override[THEME]).toBe('classic');
  });

  it('falls back to the inherited value after reverting', async () => {
    await features.setValue(ACME, ROLLOUT, 'primary', 'operator');
    await features.setValue(M1, ROLLOUT, 'shadow', 'operator');
    await features.revert(M1, ROLLOUT, 'operator');

    const byKey = new Map((await features.viewFor(M1, 'operator')).map((v) => [v.feature.key, v]));
    expect(byKey.get(ROLLOUT)!.value).toBe('primary');
    expect(byKey.get(ROLLOUT)!.provenance).toEqual({ kind: 'inherited', fromPath: ACME });
  });

  it('deletes the context when the reverted key was its only override', async () => {
    await features.setValue(P1, ROLLOUT, 'shadow', 'operator');
    await features.revert(P1, BUDGET, 'operator');
    await features.revert(P1, ROLLOUT, 'operator');
    expect(await cp.getContext({ org: 'acme', merchant: 'm1', profile: 'p1' })).toBeNull();
  });

  it('refuses a customer reverting an internal feature', async () => {
    await expect(features.revert(M1, BUDGET, 'customer')).rejects.toThrow(/may not manage/);
  });
});

describe('cohort specialization', () => {
  it('beats the profile value for a customer in the cohort', async () => {
    await features.setValue(P1, THEME, 'classic', 'operator');
    await features.setCohortValue(P1, 'gold', THEME, 'minimal', 'operator');

    const gold = await features.resolveAs(P1, 'cust_001', 'operator');
    expect(gold.config[THEME]).toBe('minimal');

    const ordinary = await features.resolveAs(P1, 'cust_777', 'operator');
    expect(ordinary.config[THEME]).toBe('classic');
  });

  it('works the same for a copied feature, since it is an explicit override', async () => {
    await features.setCohortValue(P1, 'high_risk', RETRIES, false, 'operator');
    const risky = await features.resolveAs(P1, 'cust_009', 'operator');
    expect(risky.config[RETRIES]).toBe(false);
    expect((await features.resolveAs(P1, 'cust_001', 'operator')).config[RETRIES]).toBe(true);
  });

  it('rejects a cohort name that is not in the dimension enum', async () => {
    await expect(features.setCohortValue(P1, 'platinum', THEME, 'neo', 'operator'))
      .rejects.toThrow(/platinum/);
  });

  it('refuses a customer specializing an internal feature', async () => {
    await expect(features.setCohortValue(P1, 'gold', BUDGET, 1, 'customer'))
      .rejects.toThrow(/may not manage/);
  });
});

describe('kill switch', () => {
  it('overrides every entity while leaving their overrides on disk', async () => {
    await features.setValue(ACME, RETRIES, true, 'operator');
    await features.setValue(M1, RETRIES, true, 'operator');
    await features.engageKillSwitch(RETRIES, false, 'operator');

    for (const path of [ACME, M1, P1]) {
      const resolved = await features.resolveAs(path, 'cust_777', 'operator', { killswitch: true });
      expect(resolved.config[RETRIES]).toBe(false);
    }

    expect((await cp.getContext({ org: 'acme' }))!.override[RETRIES]).toBe(true);
  });

  it('beats a cohort override too', async () => {
    await features.setCohortValue(P1, 'gold', THEME, 'minimal', 'operator');
    await features.engageKillSwitch(THEME, 'classic', 'operator');

    const gold = await features.resolveAs(P1, 'cust_001', 'operator', { killswitch: true });
    expect(gold.config[THEME]).toBe('classic');
  });

  it('restores the prior resolution exactly when disengaged', async () => {
    await features.setValue(M1, RETRIES, false, 'operator');
    const before = await features.resolveAs(M1, 'cust_777', 'operator');

    await features.engageKillSwitch(RETRIES, true, 'operator');
    await features.disengageKillSwitch(RETRIES, 'operator');

    const after = await features.resolveAs(M1, 'cust_777', 'operator');
    expect(after.config).toEqual(before.config);
  });

  it('is operator-only', async () => {
    await expect(features.engageKillSwitch(THEME, 'classic', 'customer'))
      .rejects.toThrow(/operator/);
    await expect(features.disengageKillSwitch(THEME, 'customer'))
      .rejects.toThrow(/operator/);
  });

  it('validates the emergency value against the schema', async () => {
    await expect(features.engageKillSwitch(BUDGET, 99, 'operator')).rejects.toThrow();
  });
});

describe('resolveAs', () => {
  it('never returns an internal key for a customer', async () => {
    const resolved = await features.resolveAs(M1, 'cust_001', 'customer');
    expect(Object.keys(resolved.config).some((k) => k.startsWith('internal.'))).toBe(false);
    expect(resolved.config[THEME]).toBe('classic');
  });

  it('reports the cohort it computed for the customer', async () => {
    expect((await features.resolveAs(P1, 'cust_001', 'operator')).cohort).toBe('gold');
    expect((await features.resolveAs(P1, 'cust_777', 'operator')).cohort).toBe('otherwise');
  });
});

describe('explain', () => {
  it('returns the cascade as an ordered timeline', async () => {
    await features.setValue(ACME, ROLLOUT, 'shadow', 'operator');
    await features.setValue(M1, ROLLOUT, 'primary', 'operator');

    const timeline = await features.explain(M1, ROLLOUT);
    expect(timeline.map((t) => t.value_after)).toEqual(['shadow', 'primary']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -w backend -- features`
Expected: FAIL — cannot resolve `../../src/features.js`.

- [ ] **Step 3: Implement features.ts**

`backend/src/features.ts`:

```ts
import { type CatalogEntry, buildCatalog, visibleCatalog } from './catalog.js';
import type { FeatureKey } from './model/featureKey.js';
import { type EntityPath, pathToCondition } from './model/hierarchy.js';
import { type Persona, assertCanManage, resolvePrefixes } from './model/persona.js';
import {
  type Provenance, type TimelineItem, describeProvenance, provenanceOf,
} from './model/provenance.js';
import type { ControlPlane } from './superposition/controlPlane.js';
import { COHORTS, COHORT_NAMES, type CohortName } from './superposition/schema.js';
import type { ApplicationReader } from './superposition/readPath.js';

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
    const config = await this.controlPlane.resolve(condition, {
      ...(resolvePrefixes(persona) ? { prefix: resolvePrefixes(persona)! } : {}),
    });

    const views: FeatureView[] = [];
    for (const entry of entries) {
      const timeline = await this.controlPlane.explain(entry.feature.key, condition);
      const provenance = provenanceOf(timeline, path);
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
    return this.controlPlane.explain(key, {
      ...pathToCondition(path),
      killswitch: false,
    });
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
   * Drop this entity's own value so the feature inherits again. Needs a
   * replace rather than a write, because every write API merges and so cannot
   * remove a key.
   */
  async revert(path: EntityPath, key: string, persona: Persona): Promise<void> {
    await this.entry(key, persona);
    const condition = pathToCondition(path);
    const existing = await this.controlPlane.getContext(condition);
    if (!existing || !(key in existing.override)) return;

    const remaining = { ...existing.override };
    delete remaining[key];
    await this.controlPlane.replaceContextOverrides(
      condition, remaining, `revert ${key} on ${path.join('/')}`,
    );
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
    const existing = await this.controlPlane.getContext(KILLSWITCH_CONDITION);
    if (!existing || !(key in existing.override)) return;

    const remaining = { ...existing.override };
    delete remaining[key];
    await this.controlPlane.replaceContextOverrides(
      KILLSWITCH_CONDITION, remaining, `kill switch off ${key}`,
    );
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
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -w backend -- features`
Expected: PASS, 24 tests.

- [ ] **Step 5: Run every integration suite together**

Run: `npm run test:integration -w backend`
Expected: PASS, all four suites. They share one workspace and each cleans at
start, so `--no-file-parallelism` (already in the script) is required.

- [ ] **Step 6: Commit**

```bash
git add backend/src/features.ts backend/test/integration/features.test.ts
git commit -m "feat: feature operations with persona enforcement

Revert needs an atomic replace because every write API merges; the kill switch
leaves entity overrides on disk so disengaging restores the prior resolution
exactly."
```

---

### Task 10: Provider read path and HTTP API

**Files:**
- Create: `backend/src/superposition/readPath.ts`, `backend/src/server.ts`
- Test: `backend/test/integration/readPath.test.ts`, `backend/test/integration/api.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-9.
- Produces: `ApplicationReader` with `init()`, `resolveAll(context)`, `close()`, `isStale()`; and `createApp(deps)` returning an Express app, plus `startServer()`.

- [ ] **Step 1: Write the failing provider test**

`backend/test/integration/readPath.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { ApplicationReader } from '../../src/superposition/readPath.js';
import { bootstrap } from '../../src/superposition/schema.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

const THEME = 'external.copied_till_merchant.checkout_theme';
let cp: ControlPlane;
let reader: ApplicationReader;

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await deleteAllContexts(cp);
  await bootstrap(cp);
  reader = new ApplicationReader(TEST_WORKSPACE);
  await reader.init();
});

afterAll(async () => {
  await reader?.close();
});

describe('ApplicationReader', () => {
  it('resolves the workspace defaults through the OpenFeature provider', async () => {
    const config = await reader.resolveAll({ org: 'nobody', killswitch: false });
    expect(config[THEME]).toBe('classic');
  });

  it('resolves an entity override', async () => {
    await cp.putContext({ org: 'acme' }, { [THEME]: 'neo' }, 'test');
    // ttl is 1s, so a write is visible on the next read after it expires.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const config = await reader.resolveAll({ org: 'acme', killswitch: false });
    expect(config[THEME]).toBe('neo');
  });

  it('evaluates the local cohort client-side from customer_id', async () => {
    await cp.putContext(
      { org: 'acme', customer_cohort: 'gold' }, { [THEME]: 'minimal' }, 'test',
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const gold = await reader.resolveAll({
      org: 'acme', customer_id: 'cust_001', killswitch: false,
    });
    expect(gold[THEME]).toBe('minimal');

    const ordinary = await reader.resolveAll({
      org: 'acme', customer_id: 'cust_777', killswitch: false,
    });
    expect(ordinary[THEME]).toBe('neo');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -w backend -- readPath`
Expected: FAIL — cannot resolve `../../src/superposition/readPath.js`.

- [ ] **Step 3: Implement readPath.ts**

`backend/src/superposition/readPath.ts`:

```ts
import { OpenFeature } from '@openfeature/server-sdk';
import { SuperpositionProvider } from 'superposition-provider';
import { SUPERPOSITION } from './config.js';

/**
 * The APPLICATION read path: OpenFeature over Superposition's provider, which
 * caches in process and evaluates local cohorts client-side. This is what a
 * real service embeds, and it is what the resolver probe uses, so what the
 * demo shows is what an application would see.
 *
 * On-demand refresh with ttl 1s rather than polling: a write is visible on the
 * next read, so the demo never shows a stale value. use_stale_on_error keeps
 * reads serving last-known values when Superposition is unreachable.
 *
 * Management reads do NOT come through here - see ControlPlane.resolve, which
 * is uncached and authoritative, and is what provisioning must use.
 */
export class ApplicationReader {
  private provider: SuperpositionProvider | undefined;
  private stale = false;

  constructor(private readonly workspaceId: string = SUPERPOSITION.workspaceId) {}

  async init(): Promise<void> {
    this.provider = new SuperpositionProvider({
      endpoint: SUPERPOSITION.endpoint,
      token: SUPERPOSITION.token,
      org_id: SUPERPOSITION.orgId,
      workspace_id: this.workspaceId,
      refreshStrategy: { ttl: 1, use_stale_on_error: true },
    });
    await OpenFeature.setProviderAndWait(this.provider);
  }

  async resolveAll(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.provider) throw new Error('ApplicationReader.init() was not awaited');
    try {
      const resolved = await this.provider.resolveAllConfigDetails({}, context);
      this.stale = false;
      return resolved as Record<string, unknown>;
    } catch (error) {
      this.stale = true;
      throw error;
    }
  }

  /** True when the last read failed, so the UI can say values may be stale. */
  isStale(): boolean {
    return this.stale;
  }

  async close(): Promise<void> {
    await OpenFeature.close();
    this.provider = undefined;
  }
}
```

- [ ] **Step 4: Run the provider test**

Run: `npm run test:integration -w backend -- readPath`
Expected: PASS, 3 tests. The 1.5s waits are deliberate — they prove the ttl
is short enough for the demo to feel live.

- [ ] **Step 5: Write the failing API test**

`backend/test/integration/api.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntityStore } from '../../src/entities.js';
import { FeatureService } from '../../src/features.js';
import { Provisioner } from '../../src/provisioner.js';
import { createApp } from '../../src/server.js';
import { makeClient } from '../../src/superposition/client.js';
import { SUPERPOSITION } from '../../src/superposition/config.js';
import { ControlPlane } from '../../src/superposition/controlPlane.js';
import { ApplicationReader } from '../../src/superposition/readPath.js';
import { bootstrap } from '../../src/superposition/schema.js';
import { TEST_WORKSPACE, deleteAllContexts, ensureWorkspace } from '../helpers/workspace.js';

const ROLLOUT = 'internal.inherited.decision_engine_rollout';
const THEME = 'external.copied_till_merchant.checkout_theme';

let app: Express;
let server: ReturnType<Express['listen']>;
let baseUrl: string;
let cp: ControlPlane;
let reader: ApplicationReader;

async function call(
  method: string, path: string, body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const client = makeClient();
  await ensureWorkspace(client, SUPERPOSITION.orgId, TEST_WORKSPACE, SUPERPOSITION.adminEmail);
  cp = new ControlPlane(client, SUPERPOSITION.orgId, TEST_WORKSPACE);
  await bootstrap(cp);
  reader = new ApplicationReader(TEST_WORKSPACE);
  await reader.init();
});

afterAll(async () => {
  server?.close();
  await reader?.close();
});

beforeEach(async () => {
  await deleteAllContexts(cp);
  await bootstrap(cp);
  const store = new EntityStore(join(mkdtempSync(join(tmpdir(), 'fm-')), 'entities.json'));
  app = createApp({
    controlPlane: cp,
    entities: store,
    provisioner: new Provisioner(cp, store),
    // With the reader, /api/resolve goes through the provider, as in production.
    features: new FeatureService(cp, reader),
    reader,
  });
  server?.close();
  server = app.listen(0);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

describe('GET /api/catalog', () => {
  it('returns all four features to an operator', async () => {
    const { status, body } = await call('GET', '/api/catalog?persona=operator');
    expect(status).toBe(200);
    expect(body.features).toHaveLength(4);
  });

  it('returns only external features to a customer', async () => {
    const { body } = await call('GET', '/api/catalog?persona=customer');
    expect(body.features).toHaveLength(2);
    expect(body.features.every((f: any) => f.manageability === 'external')).toBe(true);
  });

  it('rejects an unknown persona rather than defaulting to operator', async () => {
    const { status } = await call('GET', '/api/catalog?persona=admin');
    expect(status).toBe(400);
  });
});

describe('POST /api/entities', () => {
  it('creates an entity and reports the copies it made and skipped', async () => {
    const { status, body } = await call('POST', '/api/entities', {
      path: 'acme', name: 'Acme',
    });
    expect(status).toBe(201);
    expect(body.copied.map((c: any) => c.key).sort()).toEqual([
      'external.copied_till_merchant.checkout_theme',
      'internal.copied.connector_retry_budget',
    ]);
    expect(body.entity.level).toBe('org');
  });

  it('rejects a duplicate with 409', async () => {
    await call('POST', '/api/entities', { path: 'acme', name: 'Acme' });
    const { status, body } = await call('POST', '/api/entities', { path: 'acme', name: 'Again' });
    expect(status).toBe(409);
    expect(body.error).toMatch(/exists/i);
  });

  it('rejects a missing parent with 400', async () => {
    const { status } = await call('POST', '/api/entities', { path: 'ghost~m1', name: 'M1' });
    expect(status).toBe(400);
  });

  it('rejects an id carrying the separator with 400', async () => {
    const { status, body } = await call('POST', '/api/entities', { path: 'ac%7Eme', name: 'x' });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

describe('entity features', () => {
  beforeEach(async () => {
    await call('POST', '/api/entities', { path: 'acme', name: 'Acme' });
    await call('POST', '/api/entities', { path: 'acme~m1', name: 'M1' });
  });

  it('reports values with provenance', async () => {
    const { body } = await call('GET', '/api/entities/acme~m1/features?persona=operator');
    const byKey = new Map(body.features.map((f: any) => [f.key, f]));
    expect((byKey.get(THEME) as any).provenanceLabel).toBe('own');
    expect((byKey.get(ROLLOUT) as any).provenanceLabel).toBe('platform default');
  });

  it('omits internal features entirely for a customer', async () => {
    const { body } = await call('GET', '/api/entities/acme~m1/features?persona=customer');
    expect(body.features.some((f: any) => f.key.startsWith('internal.'))).toBe(false);
  });

  it('sets a value', async () => {
    const { status } = await call(
      'PUT', `/api/entities/acme~m1/features/${ROLLOUT}`, { value: 'shadow' },
    );
    expect(status).toBe(204);
    const { body } = await call('GET', '/api/entities/acme~m1/features?persona=operator');
    expect(body.features.find((f: any) => f.key === ROLLOUT).value).toBe('shadow');
  });

  it('refuses a customer writing an internal feature with 403', async () => {
    const { status } = await call(
      'PUT', `/api/entities/acme~m1/features/${ROLLOUT}?persona=customer`, { value: 'shadow' },
    );
    expect(status).toBe(403);
  });

  it('surfaces a schema violation with 400 and Superposition's own message', async () => {
    const { status, body } = await call(
      'PUT', '/api/entities/acme~m1/features/internal.copied.connector_retry_budget',
      { value: 99 },
    );
    expect(status).toBe(400);
    expect(String(body.error).length).toBeGreaterThan(0);
  });

  it('reverts a value', async () => {
    await call('PUT', `/api/entities/acme~m1/features/${ROLLOUT}`, { value: 'shadow' });
    const { status } = await call('DELETE', `/api/entities/acme~m1/features/${ROLLOUT}`);
    expect(status).toBe(204);
    const { body } = await call('GET', '/api/entities/acme~m1/features?persona=operator');
    expect(body.features.find((f: any) => f.key === ROLLOUT).provenanceLabel)
      .toBe('platform default');
  });

  it('explains one key as a timeline', async () => {
    await call('PUT', `/api/entities/acme~m1/features/${ROLLOUT}`, { value: 'shadow' });
    const { body } = await call('GET', `/api/entities/acme~m1/features/${ROLLOUT}/explain`);
    expect(body.timeline.at(-1).value_after).toBe('shadow');
  });
});

describe('kill switch and resolve', () => {
  beforeEach(async () => {
    await call('POST', '/api/entities', { path: 'acme', name: 'Acme' });
  });

  it('engages and disengages for an operator', async () => {
    expect((await call('POST', `/api/killswitch/${THEME}`, { value: 'minimal' })).status).toBe(204);
    const engaged = await call('GET', '/api/resolve?path=acme&customer_id=cust_001&killswitch=true');
    expect(engaged.body.config[THEME]).toBe('minimal');

    expect((await call('DELETE', `/api/killswitch/${THEME}`)).status).toBe(204);
  });

  it('refuses a customer engaging it with 403', async () => {
    const { status } = await call(
      'POST', `/api/killswitch/${THEME}?persona=customer`, { value: 'minimal' },
    );
    expect(status).toBe(403);
  });

  it('resolves through the provider and names the cohort', async () => {
    const { body } = await call('GET', '/api/resolve?path=acme&customer_id=cust_001');
    expect(body.cohort).toBe('gold');
    expect(body.config[THEME]).toBe('classic');
  });

  it('never returns an internal key to a customer', async () => {
    const { body } = await call(
      'GET', '/api/resolve?path=acme&customer_id=cust_001&persona=customer',
    );
    expect(Object.keys(body.config).some((k) => k.startsWith('internal.'))).toBe(false);
  });
});
```

- [ ] **Step 6: Implement server.ts**

`backend/src/server.ts`:

```ts
import express, { type Express, type Request, type Response } from 'express';
import { EntityStore } from './entities.js';
import { FeatureError, FeatureService } from './features.js';
import { HierarchyError, decodePath } from './model/hierarchy.js';
import { FeatureKeyError } from './model/featureKey.js';
import { PersonaError, parsePersona } from './model/persona.js';
import { ProvisionError, Provisioner } from './provisioner.js';
import { makeClient } from './superposition/client.js';
import { SUPERPOSITION } from './superposition/config.js';
import { ControlPlane } from './superposition/controlPlane.js';
import { ApplicationReader } from './superposition/readPath.js';
import { COHORTS } from './superposition/schema.js';

export interface Deps {
  controlPlane: ControlPlane;
  entities: EntityStore;
  provisioner: Provisioner;
  features: FeatureService;
  reader: ApplicationReader;
}

/**
 * Map a thrown error to a status code. Superposition's validation messages are
 * passed through unaltered: type and range enforcement is a feature of the
 * platform worth showing, and a generic "bad request" would hide it.
 */
function statusFor(error: unknown): number {
  if (error instanceof PersonaError) return 403;
  if (error instanceof ProvisionError) return /exists/i.test(error.message) ? 409 : 400;
  if (error instanceof HierarchyError || error instanceof FeatureKeyError) return 400;
  if (error instanceof FeatureError) {
    return /only an operator/i.test(error.message) ? 403 : 400;
  }
  return 400;
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(statusFor(error)).json({ error: message });
    }
  };
}

const personaOf = (req: Request) => parsePersona(req.query['persona'] as string | undefined);

export function createApp(deps: Deps): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, stale: deps.reader.isStale(), workspace: SUPERPOSITION.workspaceId });
  });

  app.get('/api/catalog', handle(async (req, res) => {
    const entries = await deps.features.catalog(personaOf(req));
    res.json({
      features: entries.map((entry) => ({
        key: entry.feature.key,
        name: entry.feature.name,
        manageability: entry.feature.manageability,
        propagation: entry.feature.propagation,
        schema: entry.schema,
        description: entry.description,
        default: entry.value,
      })),
      cohorts: Object.keys(COHORTS),
    });
  }));

  app.get('/api/entities', handle(async (_req, res) => {
    res.json({ tree: deps.entities.tree() });
  }));

  app.post('/api/entities', handle(async (req, res) => {
    const { path, name } = req.body as { path?: string; name?: string };
    if (!path || !name) throw new ProvisionError('path and name are required');
    const result = await deps.provisioner.createEntity({ path: decodePath(path), name });
    res.status(201).json(result);
  }));

  app.get('/api/entities/:path/features', handle(async (req, res) => {
    const views = await deps.features.viewFor(
      decodePath(req.params.path), personaOf(req),
    );
    res.json({
      features: views.map((view) => ({
        key: view.feature.key,
        name: view.feature.name,
        manageability: view.feature.manageability,
        propagation: view.feature.propagation,
        schema: view.schema,
        description: view.description,
        value: view.value,
        provenance: view.provenance,
        provenanceLabel: view.provenanceLabel,
      })),
    });
  }));

  app.get('/api/entities/:path/features/:key/explain', handle(async (req, res) => {
    const timeline = await deps.features.explain(decodePath(req.params.path), req.params.key);
    res.json({ timeline });
  }));

  app.put('/api/entities/:path/features/:key', handle(async (req, res) => {
    await deps.features.setValue(
      decodePath(req.params.path), req.params.key,
      (req.body as { value: unknown }).value, personaOf(req),
    );
    res.status(204).end();
  }));

  app.delete('/api/entities/:path/features/:key', handle(async (req, res) => {
    await deps.features.revert(decodePath(req.params.path), req.params.key, personaOf(req));
    res.status(204).end();
  }));

  app.put('/api/entities/:path/cohorts/:cohort/features/:key', handle(async (req, res) => {
    await deps.features.setCohortValue(
      decodePath(req.params.path), req.params.cohort, req.params.key,
      (req.body as { value: unknown }).value, personaOf(req),
    );
    res.status(204).end();
  }));

  app.post('/api/killswitch/:key', handle(async (req, res) => {
    await deps.features.engageKillSwitch(
      req.params.key, (req.body as { value: unknown }).value, personaOf(req),
    );
    res.status(204).end();
  }));

  app.delete('/api/killswitch/:key', handle(async (req, res) => {
    await deps.features.disengageKillSwitch(req.params.key, personaOf(req));
    res.status(204).end();
  }));

  /** The application's own view, read through the provider rather than the control plane. */
  app.get('/api/resolve', handle(async (req, res) => {
    const path = decodePath(String(req.query['path'] ?? ''));
    const customerId = String(req.query['customer_id'] ?? '');
    const killswitch = req.query['killswitch'] === 'true';
    const persona = personaOf(req);

    const view = await deps.features.resolveAs(path, customerId, persona, { killswitch });
    res.json({ ...view, stale: deps.reader.isStale() });
  }));

  return app;
}

export async function startServer(port = Number(process.env['PORT'] ?? 3001)): Promise<void> {
  const client = makeClient();
  const controlPlane = new ControlPlane(client, SUPERPOSITION.orgId, SUPERPOSITION.workspaceId);
  const entities = new EntityStore(
    process.env['ENTITY_STORE'] ?? new URL('../data/entities.json', import.meta.url).pathname,
  );
  const reader = new ApplicationReader();
  await reader.init();

  const app = createApp({
    controlPlane,
    entities,
    provisioner: new Provisioner(controlPlane, entities),
    // The reader is passed so /api/resolve reads through the provider.
    features: new FeatureService(controlPlane, reader),
    reader,
  });

  app.listen(port, () => {
    console.log(`backend on http://localhost:${port} -> workspace ${SUPERPOSITION.workspaceId}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
}
```

- [ ] **Step 7: Run the API test**

Run: `npm run test:integration -w backend -- api`
Expected: PASS, 17 tests.

- [ ] **Step 8: Run everything, then start the server by hand**

Run: `npm test -w backend && npm run test:integration -w backend`
Expected: PASS, 70 unit + 59 integration.

Run: `npm run bootstrap && npm run dev:backend`
Then: `curl -s 'http://localhost:3001/api/catalog?persona=customer' | head -c 300`
Expected: two external features, no internal ones.

- [ ] **Step 9: Commit**

```bash
git add backend/src/superposition/readPath.ts backend/src/server.ts \
        backend/test/integration/readPath.test.ts backend/test/integration/api.test.ts
git commit -m "feat: provider read path and HTTP API

Persona is enforced server-side via resolve prefixes, so internal keys are
never returned to a customer rather than being filtered in the UI."
```

---

### Task 11: Frontend shell, API client and hierarchy screen

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/tsconfig.json`
- Create: `frontend/src/main.tsx`, `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/Hierarchy.tsx`, `frontend/src/styles.css`

**Interfaces:**
- Consumes: the HTTP API from Task 10.
- Produces: types `Persona`, `Feature`, `FeatureView`, `EntityNode`, `TimelineItem`; functions `getCatalog`, `getEntities`, `createEntity`, `getFeatures`, `explainFeature`, `setFeature`, `revertFeature`, `setCohortFeature`, `engageKillSwitch`, `disengageKillSwitch`, `resolveAs`; components `App`, `Hierarchy`.

There are no automated tests in this task — it is presentation over an API
whose behavior Tasks 1-10 already pin. Verification is by running it.

- [ ] **Step 1: Scaffold the frontend package**

`frontend/package.json`:

```json
{
  "name": "frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

`frontend/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});
```

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Feature Modelling with Superposition</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Then run: `npm install`

- [ ] **Step 2: Write the API client**

`frontend/src/api.ts`:

```ts
export type Persona = 'operator' | 'customer';
export type Manageability = 'internal' | 'external';
export type Propagation = { kind: 'inherited' } | { kind: 'copied'; till: string };

export interface Feature {
  key: string;
  name: string;
  manageability: Manageability;
  propagation: Propagation;
  schema: Record<string, unknown>;
  description: string;
  default: unknown;
}

export interface FeatureView extends Omit<Feature, 'default'> {
  value: unknown;
  provenance: { kind: string; fromPath?: string[]; cohort?: string };
  provenanceLabel: string;
}

export interface Entity {
  id: string;
  name: string;
  path: string[];
  level: 'org' | 'merchant' | 'profile';
  provisioningState: 'ok' | 'provisioning_failed';
}

export interface EntityNode {
  entity: Entity;
  children: EntityNode[];
}

export interface TimelineItem {
  context_id: string;
  condition: Record<string, unknown>;
  value_before: unknown;
  value_after: unknown;
}

export interface CopyReport {
  key: string;
  value: unknown;
  fromPath: string[];
}

export interface SkipReport {
  key: string;
  reason: string;
}

export const encodePath = (path: string[]): string => path.join('~');

/** Throws with the server's own message, so Superposition's validation text reaches the UI. */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(parsed?.error ?? `${method} ${url} failed`);
  return parsed as T;
}

export const getCatalog = (persona: Persona) =>
  request<{ features: Feature[]; cohorts: string[] }>('GET', `/api/catalog?persona=${persona}`);

export const getEntities = () => request<{ tree: EntityNode[] }>('GET', '/api/entities');

export const createEntity = (path: string[], name: string) =>
  request<{ entity: Entity; copied: CopyReport[]; skipped: SkipReport[] }>(
    'POST', '/api/entities', { path: encodePath(path), name },
  );

export const getFeatures = (path: string[], persona: Persona) =>
  request<{ features: FeatureView[] }>(
    'GET', `/api/entities/${encodePath(path)}/features?persona=${persona}`,
  );

export const explainFeature = (path: string[], key: string) =>
  request<{ timeline: TimelineItem[] }>(
    'GET', `/api/entities/${encodePath(path)}/features/${key}/explain`,
  );

export const setFeature = (path: string[], key: string, value: unknown, persona: Persona) =>
  request<void>(
    'PUT', `/api/entities/${encodePath(path)}/features/${key}?persona=${persona}`, { value },
  );

export const revertFeature = (path: string[], key: string, persona: Persona) =>
  request<void>(
    'DELETE', `/api/entities/${encodePath(path)}/features/${key}?persona=${persona}`,
  );

export const setCohortFeature = (
  path: string[], cohort: string, key: string, value: unknown, persona: Persona,
) =>
  request<void>(
    'PUT',
    `/api/entities/${encodePath(path)}/cohorts/${cohort}/features/${key}?persona=${persona}`,
    { value },
  );

export const engageKillSwitch = (key: string, value: unknown, persona: Persona) =>
  request<void>('POST', `/api/killswitch/${key}?persona=${persona}`, { value });

export const disengageKillSwitch = (key: string, persona: Persona) =>
  request<void>('DELETE', `/api/killswitch/${key}?persona=${persona}`);

export const resolveAs = (
  path: string[], customerId: string, persona: Persona, killswitch: boolean,
) =>
  request<{ config: Record<string, unknown>; cohort: string; stale: boolean }>(
    'GET',
    `/api/resolve?path=${encodePath(path)}&customer_id=${encodeURIComponent(customerId)}` +
      `&persona=${persona}&killswitch=${killswitch}`,
  );
```

- [ ] **Step 3: Write the app shell with the persona toggle**

`frontend/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { type EntityNode, type Persona, getEntities } from './api.js';
import { Hierarchy } from './Hierarchy.js';

export function App() {
  const [persona, setPersona] = useState<Persona>('operator');
  const [tree, setTree] = useState<EntityNode[]>([]);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTree((await getEntities()).tree);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main>
      <header>
        <h1>Feature modelling with Superposition</h1>
        <div className="persona">
          {(['operator', 'customer'] as Persona[]).map((option) => (
            <button
              key={option}
              className={persona === option ? 'active' : ''}
              onClick={() => setPersona(option)}
            >
              {option === 'operator' ? 'Platform operator' : 'Customer'}
            </button>
          ))}
        </div>
        <p className="hint">
          {persona === 'operator'
            ? 'Seeing internal and external features.'
            : 'Seeing only external features — internal configuration is not returned by the API at all.'}
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="layout">
        <Hierarchy
          tree={tree}
          selected={selected}
          onSelect={setSelected}
          onChanged={refresh}
        />
        <div className="detail">
          {selected
            ? <p className="hint">Entity selected: {selected.join('/')} — feature table arrives in Task 12.</p>
            : <p className="hint">Select an entity, or create one.</p>}
        </div>
      </section>
    </main>
  );
}
```

`frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Write the hierarchy screen**

`frontend/src/Hierarchy.tsx`:

```tsx
import { useState } from 'react';
import {
  type CopyReport, type EntityNode, type SkipReport, createEntity,
} from './api.js';

const CHILD_LEVEL: Record<string, string | undefined> = {
  org: 'merchant',
  merchant: 'profile',
  profile: undefined,
};

interface Props {
  tree: EntityNode[];
  selected: string[] | null;
  onSelect: (path: string[]) => void;
  onChanged: () => void;
}

interface Report {
  path: string[];
  copied: CopyReport[];
  skipped: SkipReport[];
}

export function Hierarchy({ tree, selected, onSelect, onChanged }: Props) {
  const [parent, setParent] = useState<string[]>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const childLevel = parent.length === 0 ? 'org' : CHILD_LEVEL[levelAt(parent.length)];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const path = [...parent, id];
      const result = await createEntity(path, name || id);
      setReport({ path, copied: result.copied, skipped: result.skipped });
      setError(null);
      setId('');
      setName('');
      onChanged();
      onSelect(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setReport(null);
    }
  }

  return (
    <aside className="hierarchy">
      <h2>Entities</h2>
      <Nodes nodes={tree} selected={selected} onSelect={onSelect} onAddUnder={setParent} />

      {childLevel && (
        <form onSubmit={submit}>
          <h3>
            New {childLevel}
            {parent.length > 0 && <> under {parent.join('/')}</>}
          </h3>
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="id (letters, digits, - and _)"
            required
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="display name"
          />
          <div className="row">
            <button type="submit">Create</button>
            {parent.length > 0 && (
              <button type="button" onClick={() => setParent([])}>
                Create a new org instead
              </button>
            )}
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {report && (
        <div className="report">
          <h3>Provisioned {report.path.join('/')}</h3>
          <h4>Copies frozen from the parent</h4>
          {report.copied.length === 0
            ? <p className="hint">None — every feature at this level inherits.</p>
            : (
              <ul>
                {report.copied.map((copy) => (
                  <li key={copy.key}>
                    <code>{copy.key}</code> = {JSON.stringify(copy.value)}
                    {copy.fromPath.length > 0
                      ? <> from {copy.fromPath.join('/')}</>
                      : <> from the workspace default</>}
                  </li>
                ))}
              </ul>
            )}
          <h4>Copied features deliberately not written here</h4>
          {report.skipped.length === 0
            ? <p className="hint">None.</p>
            : (
              <ul>
                {report.skipped.map((skip) => (
                  <li key={skip.key}>
                    <code>{skip.key}</code> — {skip.reason}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </aside>
  );
}

function levelAt(depth: number): string {
  return ['org', 'merchant', 'profile'][depth - 1] ?? 'profile';
}

function Nodes({
  nodes, selected, onSelect, onAddUnder,
}: {
  nodes: EntityNode[];
  selected: string[] | null;
  onSelect: (path: string[]) => void;
  onAddUnder: (path: string[]) => void;
}) {
  if (nodes.length === 0) return <p className="hint">No entities yet.</p>;
  return (
    <ul className="tree">
      {nodes.map((node) => {
        const isSelected = selected?.join('~') === node.entity.path.join('~');
        return (
          <li key={node.entity.path.join('~')}>
            <span className={isSelected ? 'node selected' : 'node'}>
              <button className="link" onClick={() => onSelect(node.entity.path)}>
                {node.entity.name} <small>{node.entity.level}</small>
              </button>
              {node.entity.provisioningState === 'provisioning_failed' && (
                <span className="warn" title="provisioning failed">!</span>
              )}
              {node.entity.level !== 'profile' && (
                <button className="link" onClick={() => onAddUnder(node.entity.path)}>+</button>
              )}
            </span>
            <Nodes
              nodes={node.children}
              selected={selected}
              onSelect={onSelect}
              onAddUnder={onAddUnder}
            />
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Write minimal styles**

`frontend/src/styles.css`:

```css
:root { font-family: system-ui, sans-serif; line-height: 1.5; }
body { margin: 0; padding: 1.5rem; color: #16181d; background: #fbfbfd; }
h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
h2 { font-size: 1.1rem; } h3 { font-size: .95rem; } h4 { font-size: .85rem; margin: .75rem 0 .25rem; }
code { font-size: .85em; background: #eef0f4; padding: .1rem .3rem; border-radius: 3px; }
small { color: #6b7280; font-weight: normal; }
.hint { color: #6b7280; font-size: .9rem; }
.error { color: #b42318; background: #fef3f2; padding: .5rem .75rem; border-radius: 4px; }
.warn { color: #b54708; font-weight: bold; }
.layout { display: grid; grid-template-columns: 22rem 1fr; gap: 1.5rem; align-items: start; }
.hierarchy, .detail { background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; }
.persona button { margin-right: .5rem; padding: .35rem .8rem; cursor: pointer;
  border: 1px solid #d0d5dd; background: #fff; border-radius: 4px; }
.persona button.active { background: #16181d; color: #fff; border-color: #16181d; }
.tree { list-style: none; padding-left: .9rem; margin: .25rem 0; }
.node { display: inline-flex; gap: .4rem; align-items: baseline; }
.node.selected { background: #eef4ff; border-radius: 3px; padding: 0 .25rem; }
.link { background: none; border: none; padding: 0; color: #1849a9; cursor: pointer; font: inherit; }
form { margin-top: 1rem; display: grid; gap: .4rem; }
input, select { padding: .3rem .5rem; border: 1px solid #d0d5dd; border-radius: 4px; font: inherit; }
.row { display: flex; gap: .5rem; flex-wrap: wrap; }
button[type=submit] { padding: .35rem .8rem; cursor: pointer; border: 1px solid #16181d;
  background: #16181d; color: #fff; border-radius: 4px; }
.report { margin-top: 1rem; border-top: 1px solid #e5e7eb; padding-top: .75rem; }
.report ul { margin: .25rem 0; padding-left: 1.2rem; font-size: .9rem; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #eef0f4; vertical-align: top; }
.badge { font-size: .7rem; text-transform: uppercase; letter-spacing: .03em;
  padding: .1rem .35rem; border-radius: 3px; background: #eef0f4; color: #475467; }
.badge.internal { background: #fef0c7; color: #93370d; }
.badge.external { background: #d1fadf; color: #05603a; }
.timeline { font-size: .85rem; background: #fbfbfd; border-left: 2px solid #d0d5dd;
  padding: .4rem .6rem; margin: .4rem 0; }
.banner { background: #fef3f2; border: 1px solid #fda29b; color: #b42318;
  padding: .5rem .75rem; border-radius: 4px; margin-bottom: 1rem; }
```

- [ ] **Step 6: Run it and verify by hand**

Run, in two terminals: `npm run dev:backend` and `npm run dev:frontend`
Open http://localhost:5173.

Verify:
- creating org `acme` reports two copies frozen from the workspace default, and no skips
- creating merchant `m1` under it reports two copies frozen from `acme`
- creating profile `p1` reports one copy and names `checkout_theme` as deliberately not written, giving the boundary as the reason
- the persona toggle changes the hint text

- [ ] **Step 7: Commit**

```bash
git add frontend/ package.json package-lock.json
git commit -m "feat(frontend): app shell, API client and hierarchy screen

The create report names both the copies made and the copies deliberately
skipped, since the negative half is what shows the boundary."
```

---

### Task 12: Feature table with provenance and schema-driven editors

**Files:**
- Create: `frontend/src/ValueEditor.tsx`, `frontend/src/EntityFeatures.tsx`
- Modify: `frontend/src/App.tsx` (replace the Task 11 placeholder in `.detail`)

**Interfaces:**
- Consumes: `FeatureView`, `TimelineItem`, `getFeatures`, `explainFeature`, `setFeature`, `revertFeature` from `api.js`.
- Produces: `ValueEditor` (props `{ schema, value, onChange, disabled? }`), `EntityFeatures` (props `{ path, persona, onChanged? }`).

- [ ] **Step 1: Write the schema-driven editor**

`frontend/src/ValueEditor.tsx`:

```tsx
interface Props {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

/**
 * The input is derived from the key's JSON schema, which is why the demo uses
 * an enum, a boolean and a bounded integer rather than three booleans: each
 * renders differently, and each gives Superposition something real to reject.
 */
export function ValueEditor({ schema, value, onChange, disabled }: Props) {
  const type = schema['type'];
  const options = schema['enum'] as unknown[] | undefined;

  if (options) {
    return (
      <select
        value={String(value ?? '')}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>{String(option)}</option>
        ))}
      </select>
    );
  }

  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (type === 'integer' || type === 'number') {
    return (
      <input
        type="number"
        value={value === undefined || value === null ? '' : String(value)}
        disabled={disabled}
        min={schema['minimum'] as number | undefined}
        max={schema['maximum'] as number | undefined}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? null : type === 'integer' ? Number.parseInt(raw, 10) : Number(raw));
        }}
      />
    );
  }

  return (
    <input
      value={value === undefined || value === null ? '' : String(value)}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
```

Note: the `min`/`max` attributes are a convenience, not the guard. Deliberately
typing an out-of-range value must still reach the server so Superposition's own
rejection is what the UI shows — do not add client-side validation that would
prevent that.

- [ ] **Step 2: Write the feature table**

`frontend/src/EntityFeatures.tsx`:

```tsx
import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  type FeatureView, type Persona, type TimelineItem,
  explainFeature, getFeatures, revertFeature, setFeature,
} from './api.js';
import { ValueEditor } from './ValueEditor.js';

interface Props {
  path: string[];
  persona: Persona;
  onChanged?: () => void;
}

function propagationLabel(view: FeatureView): string {
  if (view.propagation.kind === 'inherited') return 'inherited';
  return view.propagation.till === 'profile'
    ? 'copied (every level)'
    : `copied till ${view.propagation.till}`;
}

export function EntityFeatures({ path, persona, onChanged }: Props) {
  const [views, setViews] = useState<FeatureView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [timelines, setTimelines] = useState<Record<string, TimelineItem[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { features } = await getFeatures(path, persona);
      setViews(features);
      setDrafts({});
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [path.join('~'), persona]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(view: FeatureView) {
    setBusy(true);
    try {
      await setFeature(path, view.key, drafts[view.key], persona);
      await load();
      onChanged?.();
    } catch (cause) {
      // Superposition's own validation message, verbatim.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revert(view: FeatureView) {
    setBusy(true);
    try {
      await revertFeature(path, view.key, persona);
      await load();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggleExplain(view: FeatureView) {
    if (timelines[view.key]) {
      const next = { ...timelines };
      delete next[view.key];
      setTimelines(next);
      return;
    }
    const { timeline } = await explainFeature(path, view.key);
    setTimelines({ ...timelines, [view.key]: timeline });
  }

  return (
    <div>
      <h2>{path.join('/')}</h2>
      {persona === 'customer' && (
        <p className="hint">
          Internal features are not in this response at all — the server filters
          them at the resolve call, not in the browser.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Class</th>
            <th>Value</th>
            <th>Where it came from</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {views.map((view) => {
            const dirty = view.key in drafts;
            return (
              <Fragment key={view.key}>
                <tr>
                  <td>
                    <code>{view.name}</code>
                    <div className="hint">{view.description}</div>
                  </td>
                  <td>
                    <span className={`badge ${view.manageability}`}>{view.manageability}</span>
                    <div className="hint">{propagationLabel(view)}</div>
                  </td>
                  <td>
                    <ValueEditor
                      schema={view.schema}
                      value={dirty ? drafts[view.key] : view.value}
                      disabled={busy}
                      onChange={(value) => setDrafts({ ...drafts, [view.key]: value })}
                    />
                  </td>
                  <td>
                    {view.provenanceLabel}
                    <div>
                      <button className="link" onClick={() => void toggleExplain(view)}>
                        {timelines[view.key] ? 'hide why' : 'why?'}
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="row">
                      <button disabled={!dirty || busy} onClick={() => void save(view)}>
                        Save
                      </button>
                      <button
                        className="link"
                        disabled={busy || view.provenance.kind !== 'own'}
                        title={
                          view.provenance.kind === 'own'
                            ? 'Drop this entity value and inherit again'
                            : 'Nothing of its own to revert'
                        }
                        onClick={() => void revert(view)}
                      >
                        Revert
                      </button>
                    </div>
                  </td>
                </tr>
                {timelines[view.key] && (
                  <tr>
                    <td colSpan={5}>
                      <Timeline items={timelines[view.key]!} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="hint">No context applied — this is the workspace default.</p>;
  }
  return (
    <div>
      {items.map((item, index) => (
        <div className="timeline" key={item.context_id}>
          {index + 1}. <code>{JSON.stringify(item.condition)}</code>{' '}
          changed {JSON.stringify(item.value_before)} to {JSON.stringify(item.value_after)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into App.tsx**

Replace the `.detail` block in `frontend/src/App.tsx`:

```tsx
<div className="detail">
  {selected
    ? <EntityFeatures path={selected} persona={persona} />
    : <p className="hint">Select an entity, or create one.</p>}
</div>
```

and add the import: `import { EntityFeatures } from './EntityFeatures.js';`

- [ ] **Step 4: Verify by hand**

With both dev servers running and `acme`, `acme/m1`, `acme/m1/p1` created:

- on `acme/m1/p1`, `checkout_theme` reads `inherited from acme/m1` while
  `connector_retry_budget` reads `own`, **though both show the same value they
  were copied with** — the provenance column is doing work no value comparison
  could do
- set `decision_engine_rollout` to `shadow` on `acme`; both `m1` and `p1` follow
- set `checkout_theme` to `neo` on `acme`; nothing below moves
- set `checkout_theme` to `minimal` on `acme/m1`; `p1` follows
- set `connector_retry_budget` to `8` on `acme/m1`; `p1` does not follow
- type `99` into `connector_retry_budget` and save: Superposition's own
  range-validation message appears, and the stored value is unchanged
- switch to Customer: the two internal rows are gone entirely
- click "why?" on an inherited feature: the timeline names each context and the
  value it set

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ValueEditor.tsx frontend/src/EntityFeatures.tsx frontend/src/App.tsx
git commit -m "feat(frontend): feature table with provenance and why-timelines

Editors come from each key's JSON schema, and out-of-range values are sent so
Superposition's own rejection is what the user sees."
```

---

### Task 13: Cohort, kill switch and resolver probe

**Files:**
- Create: `frontend/src/CohortPanel.tsx`, `frontend/src/KillSwitchPanel.tsx`, `frontend/src/ResolverProbe.tsx`
- Modify: `frontend/src/App.tsx` (mount the three panels)

**Interfaces:**
- Consumes: `getCatalog`, `setCohortFeature`, `engageKillSwitch`, `disengageKillSwitch`, `resolveAs` from `api.js`; `ValueEditor`.
- Produces: `CohortPanel` (`{ path, persona, cohorts, features }`), `KillSwitchPanel` (`{ persona, features, onChanged }`), `ResolverProbe` (`{ path, persona }`).

- [ ] **Step 1: Write the cohort panel**

`frontend/src/CohortPanel.tsx`:

```tsx
import { useState } from 'react';
import { type Feature, type Persona, setCohortFeature } from './api.js';
import { ValueEditor } from './ValueEditor.js';

interface Props {
  path: string[];
  persona: Persona;
  cohorts: string[];
  features: Feature[];
}

/**
 * Cohort specialization is an explicit override at weight 30, above any entity
 * path's 14 - so it behaves identically for inherited and copied features.
 * That is worth stating on screen, because the model invites the question.
 */
export function CohortPanel({ path, persona, cohorts, features }: Props) {
  const [cohort, setCohort] = useState(cohorts[0] ?? '');
  const [key, setKey] = useState(features[0]?.key ?? '');
  const [value, setValue] = useState<unknown>(features[0]?.default);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const feature = features.find((candidate) => candidate.key === key);
  if (path.length !== 3) {
    return <p className="hint">Select a profile to specialize a feature for a cohort.</p>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await setCohortFeature(path, cohort, key, value, persona);
      setStatus(`${key} = ${JSON.stringify(value)} for cohort ${cohort}`);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus(null);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>Specialize for a customer cohort</h3>
      <div className="row">
        <select value={cohort} onChange={(event) => setCohort(event.target.value)}>
          {cohorts.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setValue(features.find((f) => f.key === event.target.value)?.default);
          }}
        >
          {features.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
        </select>
        {feature && (
          <ValueEditor schema={feature.schema} value={value} onChange={setValue} />
        )}
        <button type="submit">Set</button>
      </div>
      <p className="hint">
        Writes a context at weight 30, which outranks this profile's own 14 — so
        it applies the same way whether the feature is inherited or copied.
      </p>
      {status && <p className="hint">{status}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Write the kill switch panel**

`frontend/src/KillSwitchPanel.tsx`:

```tsx
import { useState } from 'react';
import {
  type Feature, type Persona, disengageKillSwitch, engageKillSwitch,
} from './api.js';
import { ValueEditor } from './ValueEditor.js';

interface Props {
  persona: Persona;
  features: Feature[];
  onChanged: () => void;
}

/**
 * Operator-only. Writes one context at weight 64, above the 62 that every other
 * dimension sums to, so it overrides the feature everywhere at once while every
 * entity override stays on disk - disengaging therefore restores the previous
 * world exactly.
 */
export function KillSwitchPanel({ persona, features, onChanged }: Props) {
  const [key, setKey] = useState(features[0]?.key ?? '');
  const [value, setValue] = useState<unknown>(features[0]?.default);
  const [engaged, setEngaged] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (persona !== 'operator') return null;
  const feature = features.find((candidate) => candidate.key === key);

  async function engage(event: React.FormEvent) {
    event.preventDefault();
    try {
      await engageKillSwitch(key, value, persona);
      setEngaged((current) => (current.includes(key) ? current : [...current, key]));
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function disengage(target: string) {
    try {
      await disengageKillSwitch(target, persona);
      setEngaged((current) => current.filter((item) => item !== target));
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div>
      {engaged.length > 0 && (
        <div className="banner">
          Kill switch engaged for {engaged.join(', ')}. Entity overrides are
          untouched; disengaging restores them exactly.
        </div>
      )}
      <form onSubmit={engage}>
        <h3>Kill switch (operators only)</h3>
        <div className="row">
          <select
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setValue(features.find((f) => f.key === event.target.value)?.default);
            }}
          >
            {features.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
          </select>
          {feature && (
            <ValueEditor schema={feature.schema} value={value} onChange={setValue} />
          )}
          <button type="submit">Engage</button>
        </div>
        <p className="hint">
          The emergency value defaults to the platform default — the conservative
          choice — but any schema-valid value is allowed, since the requirement is
          wholesale modification, not only restoring the default.
        </p>
      </form>
      {engaged.map((item) => (
        <button key={item} className="link" onClick={() => void disengage(item)}>
          Disengage {item}
        </button>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Write the resolver probe**

`frontend/src/ResolverProbe.tsx`:

```tsx
import { useState } from 'react';
import { type Persona, resolveAs } from './api.js';

interface Props {
  path: string[];
  persona: Persona;
}

/**
 * The payoff screen: the configuration as the APPLICATION sees it, read through
 * the OpenFeature provider rather than the control plane, with the cohort the
 * local-cohort dimension computed client-side.
 */
export function ResolverProbe({ path, persona }: Props) {
  const [customerId, setCustomerId] = useState('cust_001');
  const [killswitch, setKillswitch] = useState(false);
  const [result, setResult] = useState<
    { config: Record<string, unknown>; cohort: string; stale: boolean } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function probe(event: React.FormEvent) {
    event.preventDefault();
    try {
      setResult(await resolveAs(path, customerId, persona, killswitch));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResult(null);
    }
  }

  return (
    <form onSubmit={probe}>
      <h3>What the application sees</h3>
      <div className="row">
        <input
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          placeholder="customer id"
        />
        <label>
          <input
            type="checkbox"
            checked={killswitch}
            onChange={(event) => setKillswitch(event.target.checked)}
          />{' '}
          preview with kill switch engaged
        </label>
        <button type="submit">Resolve</button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div>
          {result.stale && (
            <p className="banner">
              Superposition was unreachable on the last read; these values may be stale.
            </p>
          )}
          <p className="hint">
            {path.join('/')} · customer <code>{customerId}</code> · cohort{' '}
            <code>{result.cohort}</code>
          </p>
          <table>
            <tbody>
              {Object.entries(result.config).map(([key, value]) => (
                <tr key={key}>
                  <td><code>{key}</code></td>
                  <td>{JSON.stringify(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Mount the three panels in App.tsx**

Add to `App.tsx`: load the catalog for the current persona, and render the
panels beneath the feature table.

```tsx
const [catalog, setCatalog] = useState<{ features: Feature[]; cohorts: string[] }>({
  features: [], cohorts: [],
});
const [version, setVersion] = useState(0);

useEffect(() => {
  getCatalog(persona).then(setCatalog).catch((cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause)),
  );
}, [persona]);
```

and in `.detail`, below `<EntityFeatures … />`:

```tsx
<KillSwitchPanel
  persona={persona}
  features={catalog.features}
  onChanged={() => setVersion((n) => n + 1)}
/>
{selected && (
  <>
    <CohortPanel
      path={selected}
      persona={persona}
      cohorts={catalog.cohorts}
      features={catalog.features}
    />
    <ResolverProbe path={selected} persona={persona} />
  </>
)}
```

Pass `key={version}` to `EntityFeatures` so engaging the kill switch re-reads
the table.

- [ ] **Step 5: Verify the whole demo by hand**

With `acme`, `acme/m1`, `acme/m1/p1` created:

- on `acme/m1/p1`, set `checkout_theme` for cohort `gold` to `minimal`; the
  probe with `cust_001` shows `minimal` and cohort `gold`, while `cust_777`
  shows the profile value and cohort `otherwise`
- engage the kill switch on `payment_retries_enabled` with `false`; probe with
  "preview with kill switch engaged" — every entity reads `false`
- disengage; the probe returns to the prior values
- as Customer, the kill switch panel is absent, and the probe returns no
  `internal.*` keys

- [ ] **Step 6: Commit**

```bash
git add frontend/src/CohortPanel.tsx frontend/src/KillSwitchPanel.tsx \
        frontend/src/ResolverProbe.tsx frontend/src/App.tsx
git commit -m "feat(frontend): cohort, kill switch and resolver probe

The probe reads through the provider, so what it shows is what an application
embedding Superposition would see."
```

---

### Task 14: Seed script and walkthrough

**Files:**
- Create: `backend/scripts/seed.ts`, `README.md`
- Modify: `.gitignore` (add `backend/data/`)

**Interfaces:**
- Consumes: `Provisioner`, `FeatureService`, `EntityStore`, `ControlPlane`, `bootstrap`.
- Produces: a `npm run seed` that leaves the demo in a state where every claim in the README is one click away.

- [ ] **Step 1: Write the seed script**

`backend/scripts/seed.ts`:

```ts
import { EntityStore } from '../src/entities.js';
import { FeatureService } from '../src/features.js';
import { Provisioner } from '../src/provisioner.js';
import { makeClient } from '../src/superposition/client.js';
import { SUPERPOSITION } from '../src/superposition/config.js';
import { ControlPlane } from '../src/superposition/controlPlane.js';
import { bootstrap } from '../src/superposition/schema.js';

const ROLLOUT = 'internal.inherited.decision_engine_rollout';
const THEME = 'external.copied_till_merchant.checkout_theme';

const client = makeClient();
const controlPlane = new ControlPlane(client, SUPERPOSITION.orgId, SUPERPOSITION.workspaceId);
await bootstrap(controlPlane);

const store = new EntityStore(
  process.env['ENTITY_STORE'] ?? new URL('../data/entities.json', import.meta.url).pathname,
);
const provisioner = new Provisioner(controlPlane, store);
const features = new FeatureService(controlPlane);

/** Idempotent: skip an entity that is already registered. */
async function ensure(path: string[], name: string): Promise<void> {
  if (store.exists(path)) {
    console.log(`  ${path.join('/')} already present`);
    return;
  }
  const result = await provisioner.createEntity({ path, name });
  console.log(`  ${path.join('/')} created; copied ${result.copied.length}, skipped ${result.skipped.length}`);
}

console.log('seeding entities');
await ensure(['acme'], 'Acme Payments');
await ensure(['acme', 'm1'], 'Acme Retail');
await ensure(['acme', 'm2'], 'Acme Wholesale');
await ensure(['acme', 'm1', 'p1'], 'Retail Web');
await ensure(['acme', 'm1', 'p2'], 'Retail Mobile');

console.log('setting an org-level inherited value so descendants visibly follow');
await features.setValue(['acme'], ROLLOUT, 'shadow', 'operator');

console.log('specializing checkout_theme for the gold cohort under acme/m1/p1');
await features.setCohortValue(['acme', 'm1', 'p1'], 'gold', THEME, 'minimal', 'operator');

console.log('\nseeded. try:');
console.log('  acme/m1/p1 - checkout_theme is inherited from acme/m1, retry budget is own');
console.log('  resolve acme/m1/p1 as cust_001 (gold) vs cust_777 (otherwise)');
```

- [ ] **Step 2: Run it**

Run: `npm run seed`
Expected: five entities, the org value set, the cohort override written. Re-run
it: entity lines say "already present" and nothing errors.

- [ ] **Step 3: Write the README**

`README.md`:

````markdown
# Feature modelling with Superposition

A runnable demonstration that the values on an entity split into **features**
(inherited across a hierarchy, overridable, kill-switchable) and **attributes**
(owned, not inherited), and that features classify along two independent axes.

See [`WHAT.md`](WHAT.md) for the model, the
[design](docs/superpowers/specs/2026-10-15-superposition-feature-modelling-design.md)
for how it maps onto Superposition, and the
[plan](docs/superpowers/plans/2026-10-15-superposition-feature-modelling.md) for
how it was built.

## Run it

Superposition must be running on `localhost:8080`:

```bash
docker run -p 8080:8080 ghcr.io/juspay/superposition-demo:latest
```

Then:

```bash
npm install
npm run bootstrap     # workspace, 6 dimensions, 4 features. Also the reset button.
npm run seed          # 5 entities, an org-level value, a cohort override
npm run dev:backend   # :3001
npm run dev:frontend  # :5173
```

## The four quadrants

| key | manageability | propagation |
|---|---|---|
| `internal.inherited.decision_engine_rollout` | operators only | inherited |
| `internal.copied.connector_retry_budget` | operators only | copied, every level |
| `external.inherited.payment_retries_enabled` | customer self-serve | inherited |
| `external.copied_till_merchant.checkout_theme` | customer self-serve | copied down to merchant |

Classification lives in the key, so Superposition's `default_configs` is the
single source of truth and there is no sidecar catalog to drift.

## What to look at

**Inheritance is not our code.** Dimension positions are `org` 1, `merchant` 2,
`profile` 3, so a context's weight (Σ2^position) rises with depth and the
deepest match wins. A sibling with no override of its own simply has nothing
matching at its level.

**Copied means frozen at creation.** On `acme/m1/p1`, `checkout_theme` reads
*inherited from acme/m1* while `connector_retry_budget` reads *own* — **even
though both show the value they were copied with.** No value comparison could
tell those apart, which is why provenance comes from
`GetResolvedConfigExplanation` rather than from comparing numbers.

Try these in the feature table:

| do this | inherited features | copied features |
|---|---|---|
| edit `acme` | every descendant follows | nothing moves |
| edit `acme/m1` | its profiles follow | `checkout_theme` reaches profiles; `connector_retry_budget` does not |
| `npm run bootstrap` | existing orgs follow | nothing moves |

The middle row is the copy boundary doing work: `copied_till_merchant` means
profiles inherit the merchant's copy, while bare `copied` means every level owns
its own.

**Cohorts.** `customer_cohort` is a local cohort over `customer_id`, evaluated
client-side by the SDK. Specializing writes a context at weight 30, above any
entity path's 14 — so it works identically for inherited and copied features.
Resolve `acme/m1/p1` as `cust_001` (gold) against `cust_777` (otherwise).

**Kill switch.** One context at weight 64, above the 62 all other dimensions sum
to. Every entity override stays on disk, so disengaging restores the prior
resolution exactly. There is no coherent kill switch for a store's location,
which is the sharpest reason features and attributes differ.

**Persona.** The toggle is not cosmetic: a customer read passes
`prefix=external.` to `GetResolvedConfig`, so internal keys are never returned.
Not RBAC — the declaration in the key, honored server-side.

## Tests

```bash
npm test               # the model: pure, no Superposition needed
npm run test:integration   # behavior, against localhost:8080
```

The integration suite asserts what the model claims: copies land at the right
levels and nowhere else, an org edit moves inherited and not copied features,
the merchant boundary reaches profiles for one feature and not the other, a
cohort beats a profile, the kill switch beats everything. It also asserts the
priority arithmetic (14 > 6 > 2, 30 > 14, 64 > 62), because that ordering is
load-bearing and invisible — a dimension added later at a careless position
would break inheritance while every other test still passed.

Integration tests share the `featuredemo_test` workspace and clean it at the
*start* of each run, since Superposition has no `DeleteWorkspace` operation; a
crashed run therefore cannot poison the next.

## Out of scope

Entity attributes and their database (deliberately — `WHAT.md` excludes them),
reparenting entities, experiments and staggered rollout, real auth and RBAC,
`default_config` symlinks.
````

- [ ] **Step 4: Ignore the entity store**

Append to `.gitignore`:

```
backend/data/
```

The entity registry is runtime state. `npm run seed` recreates it.

- [ ] **Step 5: Verify the README's claims one at a time**

Work through every row of the "What to look at" tables in the running app. Any
claim that does not hold is a bug in the code or an error in the README — fix
whichever is wrong. This step is the real acceptance test for the demo: the
README is the demo's script, and a script that does not match the software is
worse than no script.

- [ ] **Step 6: Final full verification**

Run: `npm test && npm run test:integration`
Expected: PASS, everything.

- [ ] **Step 7: Commit**

```bash
git add README.md backend/scripts/seed.ts .gitignore
git commit -m "docs: seed script and walkthrough

The README's tables are the demo's script; every row was checked against the
running app."
```

---

## Notes for the executor

**Order matters.** Tasks 1-4 need nothing running. Task 5 onward need
Superposition on `localhost:8080`. Check it before starting Task 5:
`curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health` → `200`.

**The pure/impure boundary is the design.** `src/model/` must not import from
`src/superposition/`, `catalog.ts`, `entities.ts` or anything else with I/O. If
a task seems to need that import, the logic belongs on the other side of the
boundary instead.

**Three places where a plausible shortcut is wrong**, each with a test that
catches it:

1. Inferring provenance by comparing an entity's value to its parent's. They
   are equal right after a copy — the demo's central case. Read the condition.
2. Resolving the parent value for a copy through the cached provider. A copy is
   frozen forever, so a stale read bakes in a wrong value permanently. Use
   `ControlPlane.resolve`.
3. Filtering internal keys out of a customer response in our own code. Pass
   `prefix=external.` so they never arrive.

**If an SDK call shape differs** from what a task shows, the authority is the
JSDoc on the command in
`/Users/natarajan/src/superposition/clients/javascript/sdk/src/commands/`,
which carries a full example input and output for every operation.
