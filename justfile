# Feature modelling with Superposition — build, run and inspect the demo

# Default: list all recipes
default:
    @just --list

# ─── Environment ──────────────────────────────────────────────

export SUPERPOSITION_ENDPOINT := env("SUPERPOSITION_ENDPOINT", "http://localhost:8080")
export SUPERPOSITION_ORG_ID := env("SUPERPOSITION_ORG_ID", "localorg")
export SUPERPOSITION_WORKSPACE := env("SUPERPOSITION_WORKSPACE", "featuredemo")

backend_port := env("PORT", "3001")
frontend_port := "5173"

# ─── Setup ────────────────────────────────────────────────────

# One-time setup: install deps, create the workspace and schema, seed the demo
setup: install bootstrap seed
    @echo ""
    @echo "Ready. Run 'just dev' and open http://localhost:{{ frontend_port }}"

# Install workspace dependencies
install:
    npm install

# Start Superposition locally (skip if you already run it another way)
superposition:
    docker run -p 8080:8080 ghcr.io/juspay/superposition-demo:latest

# Fail fast if Superposition is not reachable
[private]
require-superposition:
    #!/usr/bin/env bash
    set -euo pipefail
    code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$SUPERPOSITION_ENDPOINT/health" || true)
    if [ "$code" != "200" ]; then
        echo "Superposition is not answering at $SUPERPOSITION_ENDPOINT (got '$code')."
        echo "Start it with 'just superposition', or set SUPERPOSITION_ENDPOINT."
        exit 1
    fi

# ─── Demo state ───────────────────────────────────────────────

# Idempotent, and also the reset button for feature values: it rewrites every
# default. It fails loudly if the dimension positions have drifted, because those
# positions ARE the precedence rules - priority is the sum of 2^position and the
# highest wins, so a wrong position breaks inheritance with no other symptom.

# Create the workspace, its 6 dimensions and its 4 features
bootstrap: require-superposition
    npm run bootstrap

# Create the demo entities and the org-level and cohort overrides
seed: require-superposition
    npm run seed

# Use this when the demo has been poked at and you want the README's walkthrough
# to be true again - a half-changed workspace makes its claims false on screen
# while nothing fails to tell you.

# Reset to a known-good demo: drop all contexts, forget entities, bootstrap, seed
reset: require-superposition
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Deleting every context in $SUPERPOSITION_WORKSPACE..."
    curl -s -m 10 -H "x-org-id: $SUPERPOSITION_ORG_ID" -H "x-workspace: $SUPERPOSITION_WORKSPACE" \
        "$SUPERPOSITION_ENDPOINT/context?all=true" \
      | python3 -c 'import sys,json; print("\n".join(r["id"] for r in json.load(sys.stdin).get("data",[])))' \
      | while read -r id; do
            [ -n "$id" ] && curl -s -m 10 -X DELETE "$SUPERPOSITION_ENDPOINT/context/$id" \
                -H "x-org-id: $SUPERPOSITION_ORG_ID" -H "x-workspace: $SUPERPOSITION_WORKSPACE" -o /dev/null
        done
    rm -f backend/data/entities.json
    echo "Entity registry removed."
    npm run bootstrap
    npm run seed

# ─── Run ──────────────────────────────────────────────────────

# Run backend and frontend together; Ctrl-C stops both
dev: require-superposition
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT INT TERM
    npm run dev:backend &
    npm run dev:frontend &
    echo ""
    echo "backend  http://localhost:{{ backend_port }}"
    echo "frontend http://localhost:{{ frontend_port }}"
    wait

# Run only the API
backend: require-superposition
    npm run dev:backend

# Run only the SPA (expects the API to be running too)
frontend:
    npm run dev:frontend

# ─── Verify ───────────────────────────────────────────────────

# Unit tests: the whole feature model, with nothing running
test:
    npm test

# Integration tests against a live Superposition, in its own throwaway workspace
test-integration: require-superposition
    npm run test:integration

# Type-check both workspaces and build the frontend
check:
    cd backend && npx tsc --noEmit
    cd frontend && npx tsc --noEmit
    npm run build -w frontend

# Everything: types, build, unit tests, integration tests
verify: check test test-integration

# ─── Inspect ──────────────────────────────────────────────────
# These read through the running API, so start it with 'just dev' first.

api := "http://localhost:" + backend_port

# The entity hierarchy
tree:
    #!/usr/bin/env bash
    set -euo pipefail
    curl -s "{{ api }}/api/entities" | python3 -c "$(cat <<'PY'
    import sys, json
    def walk(nodes, depth=0):
        for node in nodes:
            e = node["entity"]
            flag = "  !provisioning failed" if e["provisioningState"] != "ok" else ""
            print("  " + "  " * depth + f'{e["id"]} ({e["level"]}){flag}')
            walk(node["children"], depth + 1)
    tree = json.load(sys.stdin)["tree"]
    print("  (no entities yet - run 'just seed')") if not tree else walk(tree)
    PY
    )"

# One entity's features with their provenance: PATH is ~-joined, e.g. acme~m1~p1
features PATH persona="operator":
    #!/usr/bin/env bash
    set -euo pipefail
    curl -s "{{ api }}/api/entities/{{ PATH }}/features?persona={{ persona }}" | python3 -c "$(cat <<'PY'
    import sys, json
    data = json.load(sys.stdin)
    if "error" in data:
        print("  " + data["error"]); sys.exit(1)
    for f in data["features"]:
        print(f'  {f["name"]:28} = {json.dumps(f["value"]):10}  {f["provenanceLabel"]}')
    PY
    )"

# Pass a customer_id and killswitch=true to make the cohort (priority 30) and
# kill-switch (64) rows appear. Without them those two rows of the cascade cannot
# be observed at all, which is why both parameters exist.

# Why a value resolved: the cascade, with each context's priority
explain PATH KEY customer_id="" killswitch="false":
    #!/usr/bin/env bash
    set -euo pipefail
    curl -s "{{ api }}/api/entities/{{ PATH }}/features/{{ KEY }}/explain?customer_id={{ customer_id }}&killswitch={{ killswitch }}" | python3 -c "$(cat <<'PY'
    import sys, json
    data = json.load(sys.stdin)
    if "error" in data:
        print("  " + data["error"]); sys.exit(1)
    steps = data["timeline"]
    if not steps:
        print("  (no context applied - this is the platform default)")
    for s in steps:
        dims = ",".join(s["condition"].keys())
        print(f'  priority {str(s.get("weight", "?")):>3}  {dims:44} {json.dumps(s["value_before"])} -> {json.dumps(s["value_after"])}')
    PY
    )"

# What the application actually sees, read through the OpenFeature provider
resolve PATH customer_id="cust_001" persona="operator" killswitch="false":
    #!/usr/bin/env bash
    set -euo pipefail
    curl -s "{{ api }}/api/resolve?path={{ PATH }}&customer_id={{ customer_id }}&persona={{ persona }}&killswitch={{ killswitch }}" | python3 -c "$(cat <<'PY'
    import sys, json
    data = json.load(sys.stdin)
    if "error" in data:
        print("  " + data["error"]); sys.exit(1)
    stale = "  (serving stale values)" if data.get("stale") else ""
    print(f'  cohort: {data["cohort"]}{stale}')
    for k, v in sorted(data["config"].items()):
        print(f'  {k:48} = {json.dumps(v)}')
    PY
    )"

# Which features currently have an emergency override engaged
killswitches:
    #!/usr/bin/env bash
    set -euo pipefail
    curl -s "{{ api }}/api/killswitch" | python3 -c "$(cat <<'PY'
    import sys, json
    engaged = json.load(sys.stdin)["engaged"]
    print("  none engaged") if not engaged else [print("  " + k) for k in engaged]
    PY
    )"
