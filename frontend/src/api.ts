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

/** Throws with the server's own message, so Superposition's validation text reaches the UI. */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(parsed?.error ?? `${method} ${url} failed`);
  return parsed as T;
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

export const explainFeature = (path: string[], key: string) =>
  request<{ timeline: TimelineItem[] }>(
    'GET', `/api/entities/${encodePath(path)}/features/${key}/explain`,
  );

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
