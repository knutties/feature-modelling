import {
  BulkOperationCommand, CreateContextCommand, CreateDefaultConfigCommand,
  CreateDimensionCommand, DeleteContextCommand, GetContextFromConditionCommand,
  GetResolvedConfigCommand, GetResolvedConfigExplanationCommand,
  ListContextsCommand, ListDefaultConfigsCommand, ListDimensionsCommand,
  type SuperpositionClient, UpdateDefaultConfigCommand,
} from 'superposition-sdk';
import { CHANGE_REASON } from './config.js';
import type { TimelineItem } from '../model/provenance.js';

export interface DefaultConfigRow {
  key: string;
  value: unknown;
  schema: Record<string, unknown>;
  description: string;
}

export interface ContextRow {
  id: string;
  condition: Record<string, unknown>;
  override: Record<string, unknown>;
  /** Superposition returns this as a string; compare numerically. */
  weight: string;
}

export interface DimensionSpec {
  name: string;
  position: number;
  schema: Record<string, unknown>;
  description: string;
  /** Omit for a regular dimension; set to the parent name for a local cohort. */
  localCohortOf?: string;
}

/**
 * Live Superposition's errors are generic `SuperpositionServiceException`
 * instances - the server does not send the discriminator the SDK would need
 * to deserialize its own typed `ResourceNotFound` class, so `error.name` is
 * just the HTTP status code as a string (e.g. "404"). Verified against the
 * running instance: a miss on GetContextFromCondition replies
 * `404: No records found. Please refine or correct your search parameters`,
 * which does NOT contain the substring "not found" - a message-only regex
 * misses it. The status code is the reliable signal; the message regex is
 * kept only as a fallback for error shapes this probe did not exercise.
 */
function httpStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | null | undefined)
    ?.$metadata?.httpStatusCode;
}

function isNotFound(error: unknown): boolean {
  if (httpStatus(error) === 404) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not ?found/i.test(message);
}

function isAlreadyExists(error: unknown): boolean {
  if (httpStatus(error) === 409) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /already exist|duplicate|unique/i.test(message);
}

/**
 * The generated SDK types config values, overrides and conditions as its own
 * `DocumentType` union (JSON minus `undefined`), which TypeScript cannot
 * verify against our callers' `unknown`/`Record<string, unknown>`. The
 * values are genuinely dynamic JSON that Superposition validates server
 * side against the dimension/default-config schema, so this cast is the
 * boundary where that dynamism meets the SDK's stricter static type.
 */
function asDocument<T>(value: unknown): T {
  return value as T;
}

export class ControlPlane {
  constructor(
    private readonly client: SuperpositionClient,
    private readonly orgId: string,
    private readonly workspaceId: string,
  ) {}

  private get base() {
    return { org_id: this.orgId, workspace_id: this.workspaceId };
  }

  async listDefaultConfigs(): Promise<DefaultConfigRow[]> {
    const response = await this.client.send(
      new ListDefaultConfigsCommand({ ...this.base, all: true }),
    );
    return (response.data ?? []).map((row) => ({
      key: row.key!,
      value: row.value,
      schema: (row.schema ?? {}) as Record<string, unknown>,
      description: row.description ?? '',
    }));
  }

  /** Create, or update if the key is already there. Makes bootstrap a reset. */
  async putDefaultConfig(
    key: string,
    value: unknown,
    schema: Record<string, unknown>,
    description: string,
  ): Promise<void> {
    const input = asDocument<ConstructorParameters<typeof CreateDefaultConfigCommand>[0]>({
      ...this.base, key, value, schema, description, change_reason: CHANGE_REASON,
    });
    try {
      await this.client.send(new CreateDefaultConfigCommand(input));
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await this.client.send(new UpdateDefaultConfigCommand(input));
    }
  }

  async listDimensions(): Promise<{ dimension: string; position: number }[]> {
    const response = await this.client.send(
      new ListDimensionsCommand({ ...this.base, all: true }),
    );
    return (response.data ?? []).map((row) => ({
      dimension: row.dimension!,
      position: row.position!,
    }));
  }

  /** Idempotent: an existing dimension is left as it is. */
  async createDimension(spec: DimensionSpec): Promise<void> {
    try {
      await this.client.send(
        new CreateDimensionCommand(
          asDocument<ConstructorParameters<typeof CreateDimensionCommand>[0]>({
            ...this.base,
            dimension: spec.name,
            position: spec.position,
            schema: spec.schema,
            description: spec.description,
            change_reason: CHANGE_REASON,
            dimension_type: spec.localCohortOf
              ? { LOCAL_COHORT: spec.localCohortOf }
              : { REGULAR: {} },
          }),
        ),
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  async getContext(condition: Record<string, unknown>): Promise<ContextRow | null> {
    try {
      const response = await this.client.send(
        new GetContextFromConditionCommand(
          asDocument<ConstructorParameters<typeof GetContextFromConditionCommand>[0]>({
            ...this.base,
            context: condition,
          }),
        ),
      );
      return {
        id: response.id!,
        condition: (response.value ?? {}) as Record<string, unknown>,
        override: (response.override ?? {}) as Record<string, unknown>,
        weight: String(response.weight ?? '0'),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listContexts(): Promise<ContextRow[]> {
    const response = await this.client.send(
      new ListContextsCommand({ ...this.base, all: true }),
    );
    return (response.data ?? []).map((row) => ({
      id: row.id!,
      condition: (row.value ?? {}) as Record<string, unknown>,
      override: (row.override ?? {}) as Record<string, unknown>,
      weight: String(row.weight ?? '0'),
    }));
  }

  /**
   * Create the context, or merge these overrides into it if the condition
   * already has one. CreateContext is idempotent and merges on conflict, so
   * this single call is both "create" and "set a key".
   *
   * `description` is required server-side on a brand-new context (it is
   * looked up from the existing row otherwise, and a 400 "Description is
   * required when context does not exist" results if omitted) - verified
   * against the running instance. Our interface has no separate description
   * concept, so `changeReason` doubles as it.
   */
  async putContext(
    condition: Record<string, unknown>,
    override: Record<string, unknown>,
    changeReason = CHANGE_REASON,
  ): Promise<void> {
    await this.client.send(
      new CreateContextCommand(
        asDocument<ConstructorParameters<typeof CreateContextCommand>[0]>({
          ...this.base,
          request: {
            context: condition,
            override,
            description: changeReason,
            change_reason: changeReason,
          },
        }),
      ),
    );
  }

  async deleteContext(id: string): Promise<void> {
    await this.client.send(new DeleteContextCommand({ ...this.base, id }));
  }

  /**
   * Set a context's overrides to exactly `overrides`, dropping any key not
   * listed. Needed because both CreateContext and UpdateOverride MERGE, so
   * neither can remove a key. Done as one atomic BulkOperation: DELETE then
   * PUT. Passing an empty `overrides` deletes the context outright, since a
   * context with no overrides is not a thing Superposition stores.
   */
  async replaceContextOverrides(
    condition: Record<string, unknown>,
    overrides: Record<string, unknown>,
    changeReason = CHANGE_REASON,
  ): Promise<void> {
    const existing = await this.getContext(condition);
    if (!existing) {
      if (Object.keys(overrides).length > 0) {
        await this.putContext(condition, overrides, changeReason);
      }
      return;
    }

    if (Object.keys(overrides).length === 0) {
      await this.deleteContext(existing.id);
      return;
    }

    await this.client.send(
      new BulkOperationCommand(
        asDocument<ConstructorParameters<typeof BulkOperationCommand>[0]>({
          ...this.base,
          operations: [
            { DELETE: existing.id },
            {
              PUT: {
                context: condition,
                override: overrides,
                description: changeReason,
                change_reason: changeReason,
              },
            },
          ],
        }),
      ),
    );
  }

  /** Authoritative, uncached resolution. Used for provisioning and management reads. */
  async resolve(
    context: Record<string, unknown>,
    options: { prefix?: string[] } = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.client.send(
      new GetResolvedConfigCommand(
        asDocument<ConstructorParameters<typeof GetResolvedConfigCommand>[0]>({
          ...this.base,
          context,
          ...(options.prefix ? { prefix: options.prefix } : {}),
        }),
      ),
    );
    return (response.config ?? {}) as Record<string, unknown>;
  }

  /** The ordered contexts that shaped one key's value, for provenance and the probe. */
  async explain(
    key: string,
    context: Record<string, unknown>,
  ): Promise<TimelineItem[]> {
    const response = await this.client.send(
      new GetResolvedConfigExplanationCommand(
        asDocument<ConstructorParameters<typeof GetResolvedConfigExplanationCommand>[0]>({
          ...this.base,
          key,
          context,
        }),
      ),
    );
    const timeline = response.explanation?.timeline ?? [];
    return timeline.map((item) => ({
      context_id: item.context_id!,
      condition: (item.condition ?? {}) as Record<string, unknown>,
      override_id: item.override_id!,
      value_before: item.value_before,
      value_after: item.value_after,
    }));
  }
}
