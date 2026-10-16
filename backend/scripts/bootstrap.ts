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
