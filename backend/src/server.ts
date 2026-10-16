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
 *
 * `PersonaError` covers two distinct failures with one class: `parsePersona`
 * throws it for a persona VALUE that is not even a known persona (a bad
 * request - there is no such role to be forbidden from), while
 * `assertCanManage` throws it for a known persona attempting something it is
 * not permitted (genuinely forbidden). The two are told apart by message,
 * the same pattern already used below for `ProvisionError` and `FeatureError`.
 */
function statusFor(error: unknown): number {
  if (error instanceof PersonaError) return /^unknown persona/.test(error.message) ? 400 : 403;
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
      decodePath(req.params.path!), personaOf(req),
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
    const timeline = await deps.features.explain(decodePath(req.params.path!), req.params.key!);
    res.json({ timeline });
  }));

  app.put('/api/entities/:path/features/:key', handle(async (req, res) => {
    await deps.features.setValue(
      decodePath(req.params.path!), req.params.key!,
      (req.body as { value: unknown }).value, personaOf(req),
    );
    res.status(204).end();
  }));

  app.delete('/api/entities/:path/features/:key', handle(async (req, res) => {
    await deps.features.revert(decodePath(req.params.path!), req.params.key!, personaOf(req));
    res.status(204).end();
  }));

  app.put('/api/entities/:path/cohorts/:cohort/features/:key', handle(async (req, res) => {
    await deps.features.setCohortValue(
      decodePath(req.params.path!), req.params.cohort!, req.params.key!,
      (req.body as { value: unknown }).value, personaOf(req),
    );
    res.status(204).end();
  }));

  app.post('/api/killswitch/:key', handle(async (req, res) => {
    await deps.features.engageKillSwitch(
      req.params.key!, (req.body as { value: unknown }).value, personaOf(req),
    );
    res.status(204).end();
  }));

  app.delete('/api/killswitch/:key', handle(async (req, res) => {
    await deps.features.disengageKillSwitch(req.params.key!, personaOf(req));
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
