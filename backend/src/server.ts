import { fileURLToPath } from 'node:url';
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
 * Superposition's OWN validation failures (a schema violation, say) arrive
 * as a generic SDK service exception, not one of our domain error classes
 * below - but the SDK still carries the real HTTP status it got back on
 * `$metadata.httpStatusCode` (the same signal `controlPlane.ts`'s own
 * `httpStatus` helper reads, for the same reason: the live server's errors
 * do not carry a usable discriminator otherwise). A 4xx there is a genuine
 * client error Superposition itself raised and should reach the client
 * verbatim, not collapse to 500 just because it is not one of our classes.
 */
function sdkStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | null | undefined)
    ?.$metadata?.httpStatusCode;
}

/**
 * Map a thrown error to the status code it carries. Status is STRUCTURAL -
 * each of our own error classes carries its own `status`, set by the throw
 * site (see `PersonaError`, `ProvisionError`, `FeatureError`) - rather than
 * guessed here from the error's message text. Deriving status from prose
 * meant a message edit could silently change a response code, and - worse -
 * any error this function did not recognize fell through to 400, so a
 * genuine server-side failure (Superposition unreachable, the provider
 * crashing, an unanticipated exception) was reported to the client as "Bad
 * Request" rather than the 500 it actually is. `HierarchyError`/
 * `FeatureKeyError` have no variability to carry (every throw site means the
 * same thing - a malformed path or key) and are left as plain `Error`
 * subclasses, always 400. Only an error this function cannot place at all -
 * neither ours nor Superposition's own 4xx - becomes the 500 it is.
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
  const status = sdkStatus(error);
  if (typeof status === 'number' && status >= 400 && status < 500) return status;
  return 500;
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = statusFor(error);
      // Only a 5xx is logged. A 4xx is the API working as designed - a schema
      // rejection, a persona refusal, a duplicate entity - and the client is
      // already told about it in the response body. Logging those too buried
      // genuine server-side failures in a page of indistinguishable stack
      // traces, which is exactly what a log exists to prevent. Method and
      // path are included because the error alone does not say which request
      // produced it.
      if (status >= 500) console.error(`${req.method} ${req.path} failed:`, error);
      res.status(status).json({ error: message });
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

  /**
   * `customer_id` and `killswitch` are optional and default to "no customer,
   * switch disengaged" - the entity's configured view, which is what the
   * feature table asks for. Supplying them is what makes the cohort step
   * (weight 30) and the kill-switch step (weight 64) appear in the timeline
   * at all: a context naming a dimension the query does not carry cannot
   * match, so without them the two highest-weight rows of the cascade are
   * unobservable. The resolver probe passes whatever it is previewing.
   */
  app.get('/api/entities/:path/features/:key/explain', handle(async (req, res) => {
    const customerId = req.query['customer_id'];
    const timeline = await deps.features.explain(
      decodePath(req.params.path!),
      req.params.key!,
      {
        ...(typeof customerId === 'string' && customerId !== ''
          ? { customerId }
          : {}),
        killswitch: req.query['killswitch'] === 'true',
      },
    );
    res.json({ timeline });
  }));

  /**
   * Re-run provisioning for an entity whose first attempt failed. Without
   * this the `provisioning_failed` state the spec's error handling promises a
   * retry for was a dead end: re-creating the entity returns 409, so the only
   * repair was hand-editing the entity store.
   */
  app.post('/api/entities/:path/retry', handle(async (req, res) => {
    const result = await deps.provisioner.retry(decodePath(req.params.path!));
    res.json(result);
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

  /**
   * Which features are currently under an engaged kill switch, read from the
   * live contexts rather than remembered in the browser. The spec's screen 4
   * promises "a standing banner while engaged"; derived from component state
   * alone, that banner vanished on reload and never appeared in a second tab,
   * leaving a reachable state in which an emergency override is active and
   * nothing on screen says so.
   */
  app.get('/api/killswitch', handle(async (req, res) => {
    res.json({ engaged: await deps.features.engagedKillSwitches(personaOf(req)) });
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
    // fileURLToPath, not `.pathname`: a URL's pathname is percent-encoded, so
    // a checkout under a directory containing a space would hand the store a
    // path with a literal "%20" in it and it would silently write to a file
    // nobody ever looks at.
    process.env['ENTITY_STORE']
      ?? fileURLToPath(new URL('../data/entities.json', import.meta.url)),
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

  // Bound to loopback, not 0.0.0.0. Every mutating route here writes to a
  // live configuration platform with no authentication and a client-supplied
  // persona - auth is explicitly out of scope for this demo, so the write API
  // must not be reachable from the network. Vite's own dev server defaults to
  // the same.
  app.listen(port, '127.0.0.1', () => {
    console.log(`backend on http://127.0.0.1:${port} -> workspace ${SUPERPOSITION.workspaceId}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
}
