# Feature modelling demonstration using Superposition — design

Date: 2026-10-15
Status: approved for planning
Source requirements: [`WHAT.md`](../../../WHAT.md)

## Purpose

Demonstrate, in runnable form, that the values attached to an entity in software
divide into **features** (inheritable across a hierarchy, overridable, subject to
emergency override) and **attributes** (owned, not inherited, not overridable), and
that features classify along two independent axes:

- **manageability** — `internal` (platform operators only) or `external` (customers
  self-serve)
- **propagation** — `inherited` (tracks the nearest ancestor's value) or `copied`
  (frozen from the parent at entity-creation time)

The demo covers all four quadrants over a three-level hierarchy (organization →
merchant → profile), plus specialization for a customer cohort beneath a profile,
plus an emergency kill switch.

Success means a viewer can watch one screen and see *why* a value resolved the way
it did, and can see inherited and copied features visibly diverge when an ancestor
is edited. Explanation is the deliverable; the application is the vehicle.

## What is settled, and what it rests on

Each claim below was verified against the Superposition checkout at
`/Users/natarajan/src/superposition` and the live instance at `localhost:8080`
before this design was written. Implementation should not re-litigate them, but the
integration tests in [Testing](#testing) assert the load-bearing ones so a future
Superposition upgrade cannot break them silently.

| Claim | How it was verified |
|---|---|
| Superposition is reachable; org `localorg` exists with 9 workspaces | `GET /superposition/organisations`, `GET /workspaces` |
| Local auth is permissive; any token string works | `tests/env.ts` uses `"some-token"` |
| The JS provider loads and resolves on darwin/arm64 | probe ran `resolveAllConfigDetails` against workspace `test`, returned live config via prebuilt `libsuperposition_core-aarch64-apple-darwin.dylib` |
| Priority = Σ 2^position over the dimensions in a context; highest wins; ties break on insertion order | `docs/docs/superposition-config-file/deterministic-resolution.md` |
| Config keys allow only `[a-zA-Z0-9-_.]` and may not start or end with `.` | `ALPHANUMERIC_WITH_DOT` in `crates/superposition_types/src/lib.rs:171` |
| Local cohort dimensions take `dimension_type: { LOCAL_COHORT: <parent> }` and JSONLogic rules under `schema.definitions`, with `"otherwise"` in the enum | `tests/src/dimension.test.ts:26-64`; dimensions doc |
| A cohort dimension's position must be ≤ its parent's | dimensions doc, "Key Rules for All Cohort Dimensions" |
| `UpdateOverride` (PATCH `/context/overrides`) **merges** into the existing override map | `update_override_of_existing_ctx` calls `superposition_core::merge`, `crates/context_aware_config/src/api/context/helpers.rs:455-487` |
| `CreateContext` (PUT `/context`) on an existing condition also **merges** — it passes `replace: false` | `crates/context_aware_config/src/api/context/handlers.rs:162-169` |
| `BulkOperation` (PUT `/context/bulk-operations`) applies PUT / REPLACE / DELETE / MOVE in one transaction | `union ContextAction`, `smithy/models/context.smithy:330-355` |
| `GetResolvedConfigExplanation` (POST `/config/resolve/explain/{key}`) returns an ordered timeline of the contexts that applied, each with `context_id`, `condition`, `override_id`, `value_before`, `value_after` | `structure ResolveExplanation` / `ResolveExplanationTimelineItem`, `smithy/models/config.smithy:210-237` |
| `GetResolvedConfig` (POST `/config/resolve`) accepts `prefix` and `exclude_prefix` query filters over config keys | `smithy/models/config.smithy:242-252` |

The merge semantics are the consequential finding: **no single-call API shrinks a
context's override set.** This shapes the revert path in
[Writing and removing overrides](#writing-and-removing-overrides).

## The model

### Workspace

A new workspace `featuredemo` under org `localorg`. Nothing in the nine existing
workspaces is read or written.

### Dimensions

| dimension | position | weight | schema | kind |
|---|---|---|---|---|
| `org` | 1 | 2 | string | plain |
| `merchant` | 2 | 4 | string | plain |
| `profile` | 3 | 8 | string | plain |
| `customer_cohort` | 4 | 16 | enum + `definitions` | `LOCAL_COHORT:customer_id` |
| `customer_id` | 5 | 32 | string | plain |
| `killswitch` | 6 | 64 | boolean | plain |

Positions are small so the priority sums stay far from `i64` overflow and remain
checkable by hand. The ordering is load-bearing in three places:

- **Depth beats breadth.** A profile's context `{org, merchant, profile}` scores
  2+4+8 = 14 and outranks its merchant's 6 and its org's 2, so deeper overrides win.
  This is what makes inheritance work without any code of ours.
- **Cohort beats entity.** A cohort context `{org, merchant, profile, customer_cohort}`
  scores 30, above any entity path's maximum of 14.
- **Kill switch beats everything.** `{killswitch: true}` scores 64, above 62 — the
  sum of every other dimension. One row therefore overrides the feature globally.

`customer_cohort` sits below its parent `customer_id`, as Superposition requires of
cohorts. That constraint happens to give the semantics we want anyway: an override
naming an individual customer outranks one naming the cohort they fall into.

### Feature keys

A feature's classification lives in its key, parsed by the backend. There is no
sidecar catalog: type and description come from the `default_config` row itself, so
Superposition remains the single source of truth and nothing can drift out of sync.

```
<manageability>.<propagation>.<name>

manageability := internal | external
propagation   := inherited | copied | copied_till_<level>
level         := org | merchant | profile
```

`copied` is sugar for `copied_till_profile` — the deepest level, i.e. every level
owns its own copy. It has a precise meaning, not a vague one, so the common case
stays short while the boundary remains expressible.

The demo's four features, one per quadrant:

| key | schema | default | quadrant |
|---|---|---|---|
| `internal.inherited.decision_engine_rollout` | enum `off`/`shadow`/`primary` | `off` | internal + inherited |
| `internal.copied.connector_retry_budget` | integer 0–10 | `3` | internal + copied, every level |
| `external.inherited.payment_retries_enabled` | boolean | `true` | external + inherited |
| `external.copied_till_merchant.checkout_theme` | enum `classic`/`neo`/`minimal` | `classic` | external + copied, merchant boundary |

Three keys read clean. The fourth carries a boundary so the demo can show the
boundary doing work: editing a merchant moves `checkout_theme` for its profiles
(they inherit the merchant's copy) but not `connector_retry_budget` (they own
theirs). Non-boolean types are deliberate — features are configuration values, not
just flags, and enum and integer schemas also let Superposition's validation
rejections be shown off.

### Hierarchy as contexts

Every entity override carries its full ancestor path:

```
org acme               → { org: "acme" }                                  weight 2
merchant acme/m1       → { org: "acme", merchant: "m1" }                  weight 6
profile acme/m1/p1     → { org: "acme", merchant: "m1", profile: "p1" }   weight 14
```

A read sends the entity's full path, so every ancestor context matches and the
deepest wins. A sibling with no override of its own has nothing matching at its
level and lands on its parent's value. **Inheritance is the cascade, not code.**

Entity ids need only be unique within their parent; the path disambiguates. One
context per entity path carries all of that entity's overrides.

### Propagation semantics

`inherited` writes nothing at entity creation. The entity resolves through the
cascade until it reaches an ancestor that has a value, or the workspace default.

`copied_till_L` means levels down to and including `L` **own** their value; levels
below inherit from the nearest owner. On creating an entity at level `L_e` with path
`P`:

```
for each feature F where F.propagation.kind == "copied":
    if index(L_e) <= index(F.propagation.till):
        parentValue = controlPlane.resolve(F.key, parentPath(P))   # authoritative, uncached
        write override { F.key: parentValue } into the context at P
```

The parent's value is read through the control plane rather than the cached provider.
A copy is written once and frozen forever, so a stale read here would bake in a wrong
value permanently with nothing to correct it later — see
[Two read paths](#two-read-paths-deliberately).

For an org, `parentPath` is empty, so the resolve returns the workspace default and
the org materializes it. Ownership therefore starts at the top of the hierarchy and
stops at the boundary. One consequence worth demonstrating: changing the workspace
default no longer moves any existing org for a copied feature — which is the point
of a feature not drifting.

Applied to the demo's features:

| feature | org | merchant | profile |
|---|---|---|---|
| `internal.copied` (till profile) | copies | copies | copies |
| `external.copied_till_merchant` | copies | copies | inherits merchant's copy |

Why "till" rather than "at a level": a boundary is the shape of the concept, a point
is not. Copying at merchant *only* would leave an org silently tracking the
workspace default while its merchants owned their values — ownership starting in the
middle of the hierarchy, which is incoherent for a feature whose purpose is not to
drift. "Till" also matches WHAT.md's note that a value copied at level *n* "will
most likely need to allow inheritance at levels > than n".

### Kill switch

A `killswitch` dimension at the highest position. Engaging it for a feature writes
one context `{ killswitch: true }` carrying an **emergency value supplied by the
operator** at engage time, validated against the key's schema like any other write;
disengaging deletes the context. The UI pre-fills the emergency value with the
feature's workspace default, which is the conservative choice for all four of the
demo's features, but the operator may override it — a kill switch that could only
restore the default would not cover "wholesale modify", which is what WHAT.md asks
for. At weight 64 it outranks every combination of the other dimensions
(62 at most), so it wholesale-overrides the feature for every entity while leaving
every entity-level override untouched on disk — so disengaging restores the previous
world exactly.

The application's read path always sends `killswitch: false` except on the operator's
explicit emergency-preview, which sends `true`. Sending it explicitly is
belt-and-braces: a context naming a dimension absent from the query cannot match
anyway, so omitting it would also work. It is sent so that the query always states
the full dimension set, which keeps the resolver probe's display honest about what
was asked. This is the third defining
characteristic of a feature from WHAT.md, and it is the sharpest illustration of why
features and attributes differ: there is no coherent meaning to kill-switching a
store's location.

### Cohorts

`customer_cohort` is a local cohort over `customer_id`, so the SDK evaluates it
client-side with no server round trip. Membership uses `in`-list rules, the form
that appears in Superposition's own dimensions documentation:

```json
{
  "type": "string",
  "enum": ["gold", "high_risk", "otherwise"],
  "definitions": {
    "gold":      { "in": [{ "var": "customer_id" }, ["cust_001", "cust_002"]] },
    "high_risk": { "in": [{ "var": "customer_id" }, ["cust_009"]] }
  }
}
```

`in` was chosen over a prefix rule using `substr` because `in` is documented and
therefore carries no risk around which operators `juspay_jsonlogic` 0.5.5 supports.
`"otherwise"` is required in the enum as the fallback.

Specializing a feature for a cohort beneath a profile writes a context
`{org, merchant, profile, customer_cohort}` at weight 30, which beats the profile's
own 14. Cohort specialization therefore works identically for inherited and copied
features — it is an explicit override, not a propagation rule — and the demo should
say so, since it is a question the model naturally raises.

## Architecture

### Backend

Node 22, TypeScript, Express. `superposition-sdk` for the control plane (writes),
`superposition-provider` for the read path. The split below exists so that the
entire feature model is testable without a server or a network.

| module | responsibility | pure |
|---|---|---|
| `featureKey.ts` | parse/format keys; expand `copied` to `copied_till_profile` | yes |
| `hierarchy.ts` | level order, `levelOf`, `parentPath`, ancestor paths, path→condition | yes |
| `provisioning.ts` | decide which keys a new entity must copy, and from where | yes |
| `provenance.ts` | turn a resolution timeline into own / inherited-from / default | yes |
| `persona.ts` | which key prefixes a persona may see and write | yes |
| `controlPlane.ts` | SDK wrapper: contexts, overrides, bulk ops, default configs, dimensions, authoritative resolve, explanations | no |
| `readPath.ts` | provider wrapper; `{ ttl: 1 }` on-demand refresh | no |
| `catalog.ts` | list `default_configs`, parse keys, produce the catalog | no |
| `entities.ts` | entity registry, JSON file on disk | no |
| `bootstrap.ts` | idempotent workspace, dimension and default-config setup | no |
| `server.ts` | HTTP routes, wiring | no |

The five pure modules hold the model. That is where test effort concentrates.

#### Two read paths, deliberately

The demo reads configuration two different ways, and the split is not incidental —
it mirrors how this would be built for real.

**The provider** (`readPath.ts`) is the *application* read path: OpenFeature,
in-process cache, exactly what a service like Hyperswitch would embed. WHAT.md
requires the demo use it, and the resolver-probe screen is driven by it so what the
viewer sees is genuinely what an application would see. It is configured with the
on-demand refresh strategy at `ttl: 1` second rather than polling, so a write is
visible on the next read and the demo never shows a stale value, with
`use_stale_on_error: true` so reads degrade rather than fail when Superposition is
unreachable.

**The control plane** (`controlPlane.ts`) serves *management* reads, where
authority matters more than speed: resolving a parent's value when materializing a
copy, and fetching resolution explanations. A cached read is the wrong tool for
provisioning — a copy is written once and frozen forever, so reading a stale parent
value would bake in a wrong value permanently, with nothing to correct it later.
These reads use `GetResolvedConfig`, which is uncached and authoritative.

### Entity registry

A JSON file: `{ level, id, name, parentPath, provisioningState }` per entity. WHAT.md
excludes attributes and their database from scope, so this holds only what is needed
to know the hierarchy's shape. It is deliberately not a database — a reader can `cat`
it and see the whole demo's state.

### Provenance

For each feature on an entity's page the backend reports **own**, **inherited from
`<ancestor>`**, or **platform default**.

This is not computed by us. `GetResolvedConfigExplanation` returns the ordered
timeline of contexts that applied to a key, each with its condition and its
`value_before` / `value_after`. The backend asks for the explanation at the entity's
path and reads provenance off the last item in the timeline: if its condition names
the entity's own full path, the value is *own*; if it names a proper ancestor prefix,
the value is *inherited from* that ancestor; if the timeline is empty, the value is
the *platform default*.

Deriving provenance from the resolver's own explanation rather than reimplementing
the cascade matters twice over. It cannot drift from the real resolution logic, which
a parallel implementation eventually would. And it rules out the tempting shortcut of
inferring provenance by comparing an entity's value to its ancestor's: those values
are *equal* immediately after a copy, which is precisely when the
inherited-versus-copied distinction matters most, so value comparison would fail in
the demo's central case.

`provenance.ts` stays pure and holds only the presentation rule above — timeline in,
label out — so every case including the empty timeline is unit-testable with no
network.

Provenance is what turns the demo from a form into an explanation: inherited and
copied features differ visibly in their provenance column before anyone edits
anything. The full timeline is also surfaced verbatim on the resolver probe, where
each step shows one context changing the value, which is the cascade made literal.

### Writing and removing overrides

Setting a key on an entity is a single `CreateContext` call. It is `@idempotent`
and merges on an existing condition, so it creates the context when the
condition is new and merges the one key in when it is not, leaving the entity's
other overrides alone. (An earlier draft of this spec specified a
`GetContextFromCondition` lookup followed by `UpdateOverride` or
`CreateContext`; the lookup is unnecessary.)

Contexts are created lazily. An entity with nothing to copy and no edits has no
context at all, which keeps the Superposition admin UI readable as a picture of the
demo's state.

Removing a key — "revert to inherited" — cannot use either write above, because both
merge. It is one `BulkOperation`: `DELETE` the context, then `PUT` it back with the
remaining overrides, in a single transaction. If the key was the context's only
override, the `DELETE` alone suffices.

`ContextAction` also offers `REPLACE`, which may shrink an override set in one
action. The DELETE+PUT form is specified because it rests only on semantics
already confirmed in the source; an integration test establishes that it works,
and whether `REPLACE` would do the same in one action.

### Endpoints

An entity path appears in URLs as its ids joined by `~`, a character the entity-id
charset excludes: `acme`, `acme~m1`, `acme~m1~p1`. This keeps a path in a single
route segment without encoding games, and the separator cannot collide with an id.

`persona` takes `operator` or `customer`. Note that the persona names *roles* while
key prefixes name *manageability*: `operator` sees `internal.` and `external.`,
`customer` sees `external.` only. They are deliberately different vocabularies,
because a persona is who is asking and manageability is a property of the feature.

```
GET    /api/catalog                                      features with quadrant classification
GET    /api/entities                                     hierarchy tree
POST   /api/entities                                     create; materialize copies
GET    /api/entities/:path/features?persona=             resolved values + provenance
GET    /api/entities/:path/features/:key/explain         resolution timeline
PUT    /api/entities/:path/features/:key                 set own override
DELETE /api/entities/:path/features/:key                 revert to inherited
PUT    /api/entities/:path/cohorts/:cohort/features/:key cohort specialization
POST   /api/killswitch/:key                             engage, body { value }
DELETE /api/killswitch/:key                             disengage
GET    /api/resolve?path=&customer_id=&persona=         what the application sees
```

Persona is enforced in the backend, not merely hidden in the frontend, and it is
enforced *structurally*: a `customer` read passes `prefix=external.` to
`GetResolvedConfig`, so internal keys are never returned by Superposition in the
first place rather than being fetched and then filtered out by our code. Writes are
checked the same way — a `customer` request naming an `internal.*` key is rejected
before any call is made.

WHAT.md is explicit that this is not RBAC or an ACL; it is the declaration in the key
being honored. But if only the UI hid internal features, the claim that customers see
"no other configuration" would be theatre, and a demo of a *model* cannot afford a
gap between what it claims and what the code does. Pushing the filter down to the
resolve call closes it for the cost of one query parameter.

### Frontend

Vite + React. A persona toggle (Operator / Customer) is the top-level control, so
the manageability axis is visible as a change in what the page contains.

1. **Hierarchy** — the tree, with a create form per level. On creation, a panel
   reports exactly which keys were copied, from which ancestor, and which levels
   deliberately wrote nothing. The negative half of that report is the interesting
   half.
2. **Entity features** — a table of feature, quadrant badge, resolved value,
   provenance, and an editor derived from the key's JSON schema (enum → select,
   boolean → switch, integer → number). In Customer persona, internal features are
   absent rather than disabled.
3. **Cohort specialization** — on a profile page, choose a cohort and set values.
4. **Kill switch** — operator only, with a standing banner while engaged.
5. **Resolver probe** — enter a `customer_id` and see the configuration as the
   application sees it, read through the provider. Expanding a key shows its
   resolution timeline from `GetResolvedConfigExplanation`: each context that
   applied, its condition, its priority, and the value before and after it.

Screen 5 is the payoff. The timeline shows the arithmetic in
[Dimensions](#dimensions) actually deciding outcomes — one row per context, the value
visibly changing as the cascade proceeds — which is the claim the whole model rests
on, taken from the resolver itself rather than from our narration of it.

## Testing

Test-driven, per the project workflow. Two tiers.

**Unit, no network.** The five pure modules:

- key parsing and formatting, including `copied` → `copied_till_profile`, rejection
  of unknown manageability and propagation words, and rejection of keys that the
  Superposition regex would refuse
- `levelOf` / `parentPath` / ancestor enumeration, including the org's empty parent
- the copy decision: for each (feature, level) pair, whether a copy is written —
  the table in [Propagation semantics](#propagation-semantics) becomes the fixture
- provenance labelling from a synthetic resolution timeline: own, inherited from each
  depth of ancestor, and the empty timeline meaning platform default — including a
  timeline whose last two steps carry equal values, where the label must still come
  from the condition and not from the value
- persona filtering, both read and write, including that `customer` maps to
  `prefix=external.` and never to a post-hoc filter

**Integration, against the live instance** in a dedicated workspace
`featuredemotest` (Task 5 found that `featuredemo_test` is rejected: the live
server validates workspace names against `^[a-zA-Z0-9]+$`, so underscores and
hyphens 400; always reference this name through `TEST_WORKSPACE` from
`test/helpers/workspace.ts` rather than retyping it). Superposition has no
`DeleteWorkspace` operation, so the
workspace cannot be dropped; instead it is created once if absent and **cleaned
at the start of every run**. Cleaning at the start rather than the end is what
keeps the intent — a crashed run cannot poison a later one — without
accumulating workspaces. These tests assert the model's behavioral claims
rather than its internals:

- bootstrap is idempotent — running it twice leaves the same state
- creating an entity writes copies at exactly the expected levels, and writes nothing
  at the others
- editing an org moves inherited features for every descendant and moves no copied
  feature
- editing a merchant moves `checkout_theme` for its profiles and leaves
  `connector_retry_budget` alone — the boundary, demonstrated
- a cohort override beats a full profile path
- `killswitch` beats every entity and cohort override, and disengaging restores the
  prior resolution exactly
- revert-to-inherited removes one key and preserves the others in the same context
- a `customer` persona resolve never returns an `internal.*` key, asserted against
  the response rather than against the UI
- the explanation timeline's last entry names the expected condition for own,
  inherited and default cases
- the priority arithmetic itself: 14 > 6 > 2, 30 > 14, 64 > 62

The arithmetic assertions exist because that ordering is load-bearing and invisible.
A dimension added later at a careless position would silently break inheritance while
every other test still passed.

## Error handling

- **Superposition unreachable.** The provider serves stale values
  (`use_stale_on_error`) and the UI shows a banner. Reads degrade; writes fail loudly.
- **Write rejected.** Superposition's own validation message is surfaced verbatim
  rather than replaced with a generic error. Type and range enforcement is a feature
  of the platform worth showing, and an enum schema makes it easy to demonstrate.
- **Partial provisioning.** Creating an entity may involve several context writes and
  is not atomic. A failure part-way marks the entity `provisioning_failed` and offers
  a retry. Retry is safe because `UpdateOverride` merges, so re-writing a copy that
  already landed is a no-op in effect.
- **Pre-existing context.** If an entity's context already exists at creation time
  (for instance after a failed run), copies merge into it rather than displacing it.

## Non-goals

Recorded so they do not creep in: entity attributes and their database (WHAT.md
excludes them); reparenting entities (contexts carry full paths, so a move would be a
context rewrite — the demo creates and never reparents); experiments, variants and
staggered rollout; authentication and real RBAC; `default_config` symlinks; multiple
Superposition organisations or workspaces beyond the one.

## Open implementation details

1. Settled by Task 5's integration test: DELETE+PUT via `BulkOperationCommand`
   is confirmed working for shrinking an override set, so no further change is
   needed.
2. Whether `featuredemo` needs `mandatory_dimensions`. Default to none; the existing
   nine workspaces set none, and a mandatory dimension would force every context to
   name it.
3. Settled by Task 5: `all: true` is accepted by `ListDefaultConfigs`,
   `ListDimensions` and `ListContexts` against the live instance - no switch to
   `count`/`page` pagination was needed.
4. Also found by Task 5, not anticipated by this spec: `CreateContext` (and the
   `PUT` branch of `BulkOperation`) returns 400 "Description is required when
   context does not exist" unless `description` is set on a brand-new context -
   it is only optional when the condition already has a context. The adapter
   sets `description` to the same string as `change_reason`.
