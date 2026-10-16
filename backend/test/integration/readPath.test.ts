import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SuperpositionProvider } from 'superposition-provider';
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

// Each test must establish its own preconditions rather than relying on a
// previous test's write still being in effect - the shared `reader`'s cache
// means a wipe here does not itself make a test's assertions true; what
// makes them true is that this test's own write (below, after this reset)
// is the ONLY override on disk by the time its wait elapses.
beforeEach(async () => {
  await deleteAllContexts(cp);
  await bootstrap(cp);
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
    // Both the entity-level override and the cohort-level override are
    // established here, independently of any other test, since `beforeEach`
    // wipes the workspace before every test runs.
    await cp.putContext({ org: 'acme' }, { [THEME]: 'neo' }, 'test');
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

  it('marks isStale when a forced refresh fails, while still serving the last known values', async () => {
    // A reader of its own, so monkeypatching its internals cannot affect the
    // shared `reader` the other tests use.
    const flaky = new ApplicationReader(TEST_WORKSPACE);
    await flaky.init();

    const before = await flaky.resolveAll({ org: 'nobody', killswitch: false });
    expect(before[THEME]).toBe('classic');
    expect(flaky.isStale()).toBe(false);

    // Force the on-demand refresh ApplicationReader.refreshIfExpired drives -
    // via the provider's own getConfigurationClient().initialize() - to fail,
    // without touching the network. This is the same method a genuine
    // Superposition outage would cause to throw.
    const client = (flaky as unknown as { provider: SuperpositionProvider })
      .provider.getConfigurationClient();
    const originalInitialize = client.initialize.bind(client);
    client.initialize = () => Promise.reject(new Error('simulated refresh failure'));

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // let the ttl expire
      const stillCached = await flaky.resolveAll({ org: 'nobody', killswitch: false });

      expect(flaky.isStale()).toBe(true);
      // use_stale_on_error: the last known good value, not an error or a gap.
      expect(stillCached[THEME]).toBe('classic');
    } finally {
      client.initialize = originalInitialize;
      await flaky.close();
    }
  });
});
