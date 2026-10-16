import type { FeatureKey, Manageability } from './featureKey.js';

/**
 * Who is asking. Deliberately a different vocabulary from Manageability:
 * a persona is a role, manageability is a property of the feature.
 */
export type Persona = 'operator' | 'customer';

/**
 * The HTTP status this error carries is set at the throw site, not guessed
 * later from the message: `parsePersona` throws for a persona value that
 * is not even a known role (400 - a bad request, there is no role to be
 * forbidden from), while `assertCanManage` throws for a known persona
 * attempting something it may not do (403 - the default below).
 */
export class PersonaError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = 'PersonaError';
    this.status = status;
  }
}

const VISIBLE: Record<Persona, readonly Manageability[]> = {
  operator: ['internal', 'external'],
  customer: ['external'],
};

const PERSONAS = Object.keys(VISIBLE) as Persona[];

export function parsePersona(raw: string | undefined): Persona {
  if (raw === undefined) return 'operator';
  if ((PERSONAS as string[]).includes(raw)) return raw as Persona;
  throw new PersonaError(
    `unknown persona ${JSON.stringify(raw)}; expected ${PERSONAS.join(' or ')}`,
    400,
  );
}

/**
 * Key prefixes to pass to GetResolvedConfig, or undefined for no filter.
 * Filtering at the resolve call means internal keys never reach this process
 * for a customer, rather than arriving and being dropped.
 */
export function resolvePrefixes(persona: Persona): string[] | undefined {
  if (persona === 'operator') return undefined;
  return VISIBLE[persona].map((manageability) => `${manageability}.`);
}

export function canManage(persona: Persona, feature: FeatureKey): boolean {
  return VISIBLE[persona].includes(feature.manageability);
}

export function assertCanManage(persona: Persona, feature: FeatureKey): void {
  if (!canManage(persona, feature)) {
    throw new PersonaError(
      `persona ${JSON.stringify(persona)} may not manage ` +
        `${feature.manageability} feature ${JSON.stringify(feature.key)}`,
    );
  }
}
