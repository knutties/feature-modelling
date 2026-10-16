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

Note: the feature table always resolves with `killswitch: false` — it is the
management view of the underlying value, not the customer-facing one — so
engaging the kill switch does not change what you see there. To see it take
effect, resolve with `killswitch=true` through the resolver probe (or
`GET /api/resolve?...&killswitch=true`), which is the only path that honors it.

**Persona.** The toggle is not cosmetic: a customer read passes
`prefix=external.` to `GetResolvedConfig`, so internal keys are never returned.
Not RBAC — the declaration in the key, honored server-side.

**Two things Superposition's own docs get wrong or omit**, found by probing the
running instance rather than reading about it:

- A dimension's `position` on `CreateDimension` is an **insertion index**, not
  a slot you claim: the server shifts every existing dimension at or above
  that position up by one, like inserting into a sorted list by index. That is
  why `bootstrap()` creates `customer_id` before `customer_cohort` even though
  `customer_id` sits at a higher position — see the comment above
  `bootstrap()` in `backend/src/superposition/schema.ts` for the exact
  ordering this forces.
- The provider's documented on-demand `ttl` refresh (`refreshStrategy: { ttl,
  use_stale_on_error }`) is **inert** on the config-read path in
  `superposition-provider@0.118.2`: it is honored only by the experimentation
  subsystem, not by `resolveAllConfigDetails`. `ApplicationReader` (in
  `backend/src/superposition/readPath.ts`) works around this by calling
  `getConfigurationClient().initialize()` itself once the ttl elapses — without
  that, a write made through the UI would never become visible to the
  customer-facing resolve.

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

Integration tests share the `featuredemotest` workspace (not
`featuredemo_test` — the live server rejects underscores in a workspace name)
and clean it at the *start* of each run, since Superposition has no
`DeleteWorkspace` operation; a crashed run therefore cannot poison the next.

The suite's `console.error` output is not pristine: the server logs every
caught error unconditionally, including the 400/403/409s that the error-path
tests deliberately trigger, so a clean integration run still prints a page of
stack traces. That's a known, deferred one-line fix (only log 5xx), not a sign
of a failing test — check the PASS/FAIL summary, not the log noise above it.

## Out of scope

Entity attributes and their database (deliberately — `WHAT.md` excludes them),
reparenting entities, experiments and staggered rollout, real auth and RBAC,
`default_config` symlinks.
