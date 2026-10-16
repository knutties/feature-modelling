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
 * Map a thrown error to the status code it carries. Status is STRUCTURAL -
 * each error class carries its own `status`, set by the throw site (see
 * `PersonaError`, `ProvisionError`, `FeatureError`) - rather than guessed
 * here from the error's message text. Deriving status from prose meant a
 * message edit could silently change a response code, and - worse - any
 * error this function did not recognize fell through to 400, so a genuine
 * server-side failure (Superposition unreachable, the provider crashing, an
 * unanticipated exception) was reported to the client as "Bad Request"
 * rather than the 500 it actually is. `HierarchyError`/`FeatureKeyError` have
 * no variability to carry (every throw site means the same thing - a
 * malformed path or key) and are left as plain `Error` subclasses.
 */
function statusFor(error: unknown): number {
  if (error instanceof HierarchyError || error instanceof FeatureKeyError) return 400;
  if (
    error instanceof PersonaError ||
    error instanceof ProvisionError ||
    error instanceof FeatureError
  ) {
    return error.status;
  }
  return 500;
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      // Logged unconditionally so an unexpected failure is visible server
      // side too, not only in the HTTP response body the client sees.
      console.error(error);
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
