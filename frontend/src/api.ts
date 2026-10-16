export type Persona = 'operator' | 'customer';
export type Manageability = 'internal' | 'external';
export type Level = 'org' | 'merchant' | 'profile';
export type Propagation = { kind: 'inherited' } | { kind: 'copied'; till: Level };

export type Provenance =
  | { kind: 'default' }
  | { kind: 'own' }
  | { kind: 'inherited'; fromPath: string[] }
  | { kind: 'cohort'; cohort: string }
  | { kind: 'killswitch' };

export interface Feature {
  key: string;
  name: string;
  manageability: Manageability;
  propagation: Propagation;
  schema: Record<string, unknown>;
  description: string;
  default: unknown;
}

export interface FeatureView extends Omit<Feature, 'default'> {
  value: unknown;
  provenance: Provenance;
  provenanceLabel: string;
}

export interface Entity {
  id: string;
  name: string;
  path: string[];
  level: 'org' | 'merchant' | 'profile';
  provisioningState: 'ok' | 'provisioning_failed';
}

export interface EntityNode {
  entity: Entity;
  children: EntityNode[];
}

export interface TimelineItem {
  context_id: string;
  condition: Record<string, unknown>;
  value_before: unknown;
  value_after: unknown;
  /**
   * The context's priority: Sum(2^position) over the dimensions it names, the
   * number Superposition compares to decide which context wins. The
   * explanation API returns no priority field, so the backend computes it from
   * the same dimension positions bootstrap created.
   */
  weight: number;
}

export interface CopyReport {
  key: string;
  value: unknown;
  fromPath: string[];
}

export interface SkipReport {
  key: string;
  reason: string;
}

export const encodePath = (path: string[]): string => path.join('~');

/**
 * Not every error body is JSON. Express's own 404 page and body-parser's
 * malformed-JSON reply are both HTML, and parsing those unconditionally
 * surfaced the real failure to the user as `Unexpected token '<'`. A body that
 * does not parse is reported as the status instead.
 */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Throws with the server's own message, so Superposition's validation text reaches the UI. */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text ? parseJson(text) : { ok: true as const, value: null };
  const message = parsed.ok
    ? (parsed.value as { error?: string } | null)?.error
    : undefined;

  if (!response.ok) {
    throw new Error(
      message ?? `${method} ${url} failed: ${response.status} ${response.statusText}`.trim(),
    );
  }
  if (!parsed.ok) {
    throw new Error(`${method} ${url} returned a body that is not JSON`);
  }
  return parsed.value as T;
}

export const getCatalog = (persona: Persona) =>
  request<{ features: Feature[]; cohorts: string[] }>('GET', `/api/catalog?persona=${persona}`);

export const getEntities = () => request<{ tree: EntityNode[] }>('GET', '/api/entities');

export const createEntity = (path: string[], name: string) =>
  request<{ entity: Entity; copied: CopyReport[]; skipped: SkipReport[] }>(
    'POST', '/api/entities', { path: encodePath(path), name },
  );

export const getFeatures = (path: string[], persona: Persona) =>
  request<{ features: FeatureView[] }>(
    'GET', `/api/entities/${encodePath(path)}/features?persona=${persona}`,
  );

/**
 * `customerId` and `killswitch` widen the resolution the timeline explains.
 * Omitting them (what the feature table does) asks for the entity's own
 * configured view; passing them (what the resolver probe does) is the only way
 * the cohort context at weight 30 and the kill-switch context at weight 64 can
 * appear in the timeline at all.
 */
export const explainFeature = (
  path: string[], key: string, options: { customerId?: string; killswitch?: boolean } = {},
) => {
  const query = new URLSearchParams();
  if (options.customerId) query.set('customer_id', options.customerId);
  if (options.killswitch) query.set('killswitch', 'true');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<{ timeline: TimelineItem[] }>(
    'GET', `/api/entities/${encodePath(path)}/features/${key}/explain${suffix}`,
  );
};

export const retryEntity = (path: string[]) =>
  request<{ entity: Entity; copied: CopyReport[]; skipped: SkipReport[] }>(
    'POST', `/api/entities/${encodePath(path)}/retry`,
  );

/** Which features are under an engaged kill switch, per the live contexts. */
export const getEngagedKillSwitches = (persona: Persona) =>
  request<{ engaged: string[] }>('GET', `/api/killswitch?persona=${persona}`);

export const setFeature = (path: string[], key: string, value: unknown, persona: Persona) =>
  request<void>(
    'PUT', `/api/entities/${encodePath(path)}/features/${key}?persona=${persona}`, { value },
  );

export const revertFeature = (path: string[], key: string, persona: Persona) =>
  request<void>(
    'DELETE', `/api/entities/${encodePath(path)}/features/${key}?persona=${persona}`,
  );

export const setCohortFeature = (
  path: string[], cohort: string, key: string, value: unknown, persona: Persona,
) =>
  request<void>(
    'PUT',
    `/api/entities/${encodePath(path)}/cohorts/${cohort}/features/${key}?persona=${persona}`,
    { value },
  );

export const engageKillSwitch = (key: string, value: unknown, persona: Persona) =>
  request<void>('POST', `/api/killswitch/${key}?persona=${persona}`, { value });

export const disengageKillSwitch = (key: string, persona: Persona) =>
  request<void>('DELETE', `/api/killswitch/${key}?persona=${persona}`);

export const resolveAs = (
  path: string[], customerId: string, persona: Persona, killswitch: boolean,
) =>
  request<{ config: Record<string, unknown>; cohort: string; stale: boolean }>(
    'GET',
    `/api/resolve?path=${encodePath(path)}&customer_id=${encodeURIComponent(customerId)}` +
      `&persona=${persona}&killswitch=${killswitch}`,
  );
