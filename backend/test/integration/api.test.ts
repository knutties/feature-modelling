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
    // 'ac.me' fails id validation directly (the id charset forbids '.'). A
    // literal 'ac~me' would decode to the valid two-segment path ['ac','me']
    // and fail as a missing parent instead, and a JSON body never carries
    // '%7E' through URL-decoding, so neither alternative exercises the id
    // check this test is meant to cover.
    const { status, body } = await call('POST', '/api/entities', { path: 'ac.me', name: 'x' });
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

  it("surfaces a schema violation with 400 and Superposition's own message", async () => {
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
