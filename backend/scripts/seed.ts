import { fileURLToPath } from 'node:url';
import { EntityStore } from '../src/entities.js';
import { FeatureService } from '../src/features.js';
import { Provisioner } from '../src/provisioner.js';
import { makeClient } from '../src/superposition/client.js';
import { SUPERPOSITION } from '../src/superposition/config.js';
import { ControlPlane } from '../src/superposition/controlPlane.js';
import { bootstrap } from '../src/superposition/schema.js';
import { ensureWorkspace } from '../src/superposition/workspace.js';

const ROLLOUT = 'internal.inherited.decision_engine_rollout';
const THEME = 'external.copied_till_merchant.checkout_theme';

const client = makeClient();
// Fresh instance safety: bootstrap assumes the workspace already exists (it
// only creates dimensions and default configs), so ensure it first - the same
// order scripts/bootstrap.ts uses.
await ensureWorkspace(
  client, SUPERPOSITION.orgId, SUPERPOSITION.workspaceId, SUPERPOSITION.adminEmail,
);
const controlPlane = new ControlPlane(client, SUPERPOSITION.orgId, SUPERPOSITION.workspaceId);
await bootstrap(controlPlane);

const store = new EntityStore(
  // fileURLToPath, not `.pathname`: a pathname is percent-encoded, so a
  // checkout under a directory containing a space would seed a file with a
  // literal "%20" in its path while the server read the real one.
  process.env['ENTITY_STORE']
    ?? fileURLToPath(new URL('../data/entities.json', import.meta.url)),
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
