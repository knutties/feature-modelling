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

### With `just`

A [`justfile`](justfile) wraps all of the above. `just` on its own lists everything.

```bash
just setup            # install, bootstrap, seed - the whole first run
just dev              # both servers; Ctrl-C stops both
just reset            # back to a known-good demo after you have poked at it
just verify           # types, build, unit tests, integration tests
```

It also reads the demo from the command line, which is the fastest way to see the
model without clicking:

```bash
just tree                                     # the entity hierarchy
just features acme~m1~p1                      # values with their provenance
just features acme~m1~p1 customer             # the same entity as a customer sees it
just resolve  acme~m1~p1 cust_001             # what the application resolves
just explain  acme~m1~p1 <key> cust_001 true  # the cascade, with each context's priority
just killswitches                             # any emergency override currently engaged
```

`just explain` is the one worth running. Without a `customer_id` it shows only the
entity rows; name a cohort customer and the priority-30 row appears, add
`killswitch=true` and the priority-64 row joins it — the two rows that decide the
most interesting cases, which no other screen can show you.

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
Because the table cannot show it, the banner that says a switch is engaged is
read back from the live contexts (`GET /api/killswitch`) rather than remembered
in the browser — so it survives a reload and appears in a second tab.

**The resolver probe is the payoff.** Resolve, then expand any key with
*why?*: the timeline is every context that applied, in order, each with its
condition, **its priority** and the value before and after it. The priority
column is the arithmetic above deciding outcomes, taken from the resolver's own
explanation rather than from this README. The timeline explains *that* read, so
the two highest-weight rows of the cascade are observable only here: resolve
`acme/m1/p1` as `cust_001` and the cohort context shows up at priority 30; tick
*preview with kill switch engaged* and the kill-switch context shows up at 64,
above every entity row. The feature table's own *why?* asks for neither, by
design — it explains the entity as configured.

(`GetResolvedConfigExplanation` returns no priority field; the backend computes
it with the same Σ2^position the server uses, and an integration test pins the
two against each other on live contexts.)

**A failed creation is recoverable.** Provisioning an entity is several context
writes and is not atomic; a part-way failure marks the entity
`provisioning_failed` and the tree shows a `!` with a **Retry** button beside
it (`POST /api/entities/:path/retry`). Retry is safe because the writes merge,
so re-writing a copy that already landed is a no-op; re-provisioning a *healthy*
entity is refused, because that would re-resolve the parent and unfreeze a
copied feature through the back door.

**Persona.** The toggle is not cosmetic: a customer read passes
`prefix=external.` to `GetResolvedConfig`, so internal keys are never returned.
That structural push-down covers the management reads; the customer-facing
`/api/resolve` is the one exception, and necessarily so — it reads through the
provider, whose `resolveAllConfigDetails` takes no prefix parameter and caches
the whole config in-process anyway, so there the filter is applied to the
provider's result. The response guarantee is the same on both paths and is
tested against the response. Not RBAC — the declaration in the key, honored
server-side.

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
priority arithmetic (14 > 6 > 2, 30 > 14, 64 > 62) against the weights
*Superposition itself* computed and stored for live contexts, because that
ordering is load-bearing and invisible — a dimension added later at a careless
position, or an upgrade that changed the weighting, would break inheritance
while every unit test still passed.

Integration tests share the `featuredemotest` workspace (not
`featuredemo_test` — the live server rejects underscores in a workspace name)
and clean it at the *start* of each run, since Superposition has no
`DeleteWorkspace` operation; a crashed run therefore cannot poison the next.

The server logs only 5xx responses, so a clean integration run is quiet: the
400/403/409s the error-path tests deliberately trigger are the API working as
designed and are reported in the response, not the log. A stack trace during a
test run therefore means something genuinely went wrong server-side.

## Out of scope

Entity attributes and their database (deliberately — `WHAT.md` excludes them),
reparenting entities, experiments and staggered rollout, real auth and RBAC,
`default_config` symlinks.
