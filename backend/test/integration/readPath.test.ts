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
