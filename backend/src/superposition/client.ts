import { SuperpositionClient } from 'superposition-sdk';
import { SUPERPOSITION } from './config.js';

/**
 * The token is a nested object, not a bare string - `{ token: { token: "..." } }`.
 * Passing a string fails at request time with an unhelpful error.
 */
export function makeClient(
  overrides: { endpoint?: string; token?: string } = {},
): SuperpositionClient {
  return new SuperpositionClient({
    endpoint: overrides.endpoint ?? SUPERPOSITION.endpoint,
    token: { token: overrides.token ?? SUPERPOSITION.token },
  });
}
