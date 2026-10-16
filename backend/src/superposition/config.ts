export const SUPERPOSITION = {
  endpoint: process.env['SUPERPOSITION_ENDPOINT'] ?? 'http://localhost:8080',
  /** Local Superposition accepts any token; auth is permissive. */
  token: process.env['SUPERPOSITION_TOKEN'] ?? 'some-token',
  orgId: process.env['SUPERPOSITION_ORG_ID'] ?? 'localorg',
  workspaceId: process.env['SUPERPOSITION_WORKSPACE'] ?? 'featuredemo',
  adminEmail: process.env['SUPERPOSITION_ADMIN_EMAIL'] ?? 'admin@localorg.io',
} as const;

/** Every Superposition write needs one; ours say which part of the demo wrote. */
export const CHANGE_REASON = 'feature-modelling demo';
