import { type EvaluationContext, OpenFeature } from '@openfeature/server-sdk';
import { SuperpositionProvider } from 'superposition-provider';
import { SUPERPOSITION } from './config.js';

/**
 * Matches the `ttl` passed into `refreshStrategy` below, in seconds; kept as
 * one constant so the configured strategy and the manual refresh timer below
 * (see `refreshIfExpired`) cannot drift apart.
 */
const TTL_SECONDS = 1;

/**
 * The APPLICATION read path: OpenFeature over Superposition's provider, which
 * caches in process and evaluates local cohorts client-side. This is what a
 * real service embeds, and it is what the resolver probe uses, so what the
 * demo shows is what an application would see.
 *
 * On-demand refresh with ttl 1s rather than polling: a write is visible on the
 * next read, so the demo never shows a stale value. use_stale_on_error keeps
 * reads serving last-known values when Superposition is unreachable.
 *
 * Management reads do NOT come through here - see ControlPlane.resolve, which
 * is uncached and authoritative, and is what provisioning must use.
 *
 * DIVERGENCE FROM THE DOCUMENTED CONTRACT, verified by reading
 * node_modules/superposition-provider/dist/index.esm.js (package version
 * 0.118.2, the latest published): `refreshStrategy: { ttl, use_stale_on_error }`
 * is honored only by the provider's EXPERIMENTATION (A/B testing) subsystem.
 * `ConfigurationClient`'s constructor schedules a refetch only when the
 * strategy carries `interval` (polling); the methods behind
 * `resolveAllConfigDetails` - `eval` and `getAllConfigValue` - both fetch the
 * whole config exactly once (`if (!this.currentConfigData) { fetch }`) and
 * otherwise serve that same in-memory snapshot forever, with no ttl check
 * anywhere on that path. Passing `{ ttl: 1, use_stale_on_error: true }` is
 * therefore a silent no-op for the read path this class uses: without the
 * code below, a write would never become visible, which this was confirmed
 * against the live instance by probing `resolveAllConfigDetails` before and
 * after a direct write with and without a manual refetch.
 *
 * `refreshIfExpired` reimplements the documented on-demand contract using the
 * provider's own public surface: `getConfigurationClient().initialize()`
 * performs the same unconditional GetConfig fetch the provider's own startup
 * path uses, and only overwrites the cached snapshot on success - so a failed
 * refresh (the `use_stale_on_error` case) leaves the previous good snapshot in
 * the native cache untouched, and the subsequent `resolveAllConfigDetails`
 * call below still serves it.
 */
export class ApplicationReader {
  private provider: SuperpositionProvider | undefined;
  private stale = false;
  private lastFetch = 0;

  constructor(private readonly workspaceId: string = SUPERPOSITION.workspaceId) {}

  async init(): Promise<void> {
    this.provider = new SuperpositionProvider({
      endpoint: SUPERPOSITION.endpoint,
      token: SUPERPOSITION.token,
      org_id: SUPERPOSITION.orgId,
      workspace_id: this.workspaceId,
      refreshStrategy: { ttl: TTL_SECONDS, use_stale_on_error: true },
    });
    await OpenFeature.setProviderAndWait(this.provider);
    // setProviderAndWait already performed the one fetch the library's own
    // startup path makes (see the class doc) - record it as the baseline.
    this.lastFetch = Date.now();
  }

  async resolveAll(context: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.provider) throw new Error('ApplicationReader.init() was not awaited');
    await this.refreshIfExpired();
    try {
      // The caller's context is genuinely dynamic JSON (customer_id, cohort,
      // killswitch, ...) typed as unknown at our boundary; OpenFeature's
      // EvaluationContext is that same JSON with a narrower static type.
      const resolved = await this.provider.resolveAllConfigDetails(
        {}, context as unknown as EvaluationContext,
      );
      this.stale = false;
      return resolved as Record<string, unknown>;
    } catch (error) {
      this.stale = true;
      throw error;
    }
  }

  /** See the class doc: the library does not do this itself for this read path. */
  private async refreshIfExpired(): Promise<void> {
    if (!this.provider) return;
    if (Date.now() - this.lastFetch < TTL_SECONDS * 1000) return;
    try {
      await this.provider.getConfigurationClient().initialize();
      this.lastFetch = Date.now();
    } catch {
      // use_stale_on_error: keep serving the last successfully fetched
      // snapshot, which `initialize()` left untouched on this failure.
      this.stale = true;
    }
  }

  /** True when the last read failed, so the UI can say values may be stale. */
  isStale(): boolean {
    return this.stale;
  }

  async close(): Promise<void> {
    await OpenFeature.close();
    this.provider = undefined;
  }
}
