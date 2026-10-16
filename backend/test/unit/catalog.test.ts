import { describe, expect, it, vi } from 'vitest';
import { buildCatalog, visibleCatalog } from '../../src/catalog.js';

const rows = [
  { key: 'internal.inherited.decision_engine_rollout', value: 'off', schema: { type: 'string' }, description: 'a' },
  { key: 'internal.copied.connector_retry_budget', value: 3, schema: { type: 'integer' }, description: 'b' },
  { key: 'external.inherited.payment_retries_enabled', value: true, schema: { type: 'boolean' }, description: 'c' },
  { key: 'external.copied_till_merchant.checkout_theme', value: 'classic', schema: { type: 'string' }, description: 'd' },
];

describe('buildCatalog', () => {
  it('parses every well-formed key and keeps its value and schema', () => {
    const catalog = buildCatalog(rows);
    expect(catalog).toHaveLength(4);
    const theme = catalog.find((e) => e.feature.name === 'checkout_theme')!;
    expect(theme.feature.manageability).toBe('external');
    expect(theme.feature.propagation).toEqual({ kind: 'copied', till: 'merchant' });
    expect(theme.value).toBe('classic');
    expect(theme.schema).toEqual({ type: 'string' });
  });

  it('sorts by key so the UI order is stable', () => {
    const keys = buildCatalog([...rows].reverse()).map((e) => e.feature.key);
    expect(keys).toEqual([...keys].sort());
  });

  /**
   * Review Focus 4: someone adds a key by hand in the admin UI. The catalog
   * must skip it with a warning rather than throwing, or one stray key takes
   * every feature page down.
   */
  it('skips a key that does not follow the scheme and warns', () => {
    const warn = vi.fn();
    const catalog = buildCatalog(
      [...rows, { key: 'stray_key', value: 1, schema: {}, description: '' }],
      warn,
    );
    expect(catalog).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('stray_key');
  });

  it('skips a key with a known manageability but a bad propagation', () => {
    const warn = vi.fn();
    const catalog = buildCatalog(
      [...rows, { key: 'internal.sometimes.thing', value: 1, schema: {}, description: '' }],
      warn,
    );
    expect(catalog).toHaveLength(4);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('returns an empty catalog for no rows', () => {
    expect(buildCatalog([])).toEqual([]);
  });
});

describe('visibleCatalog', () => {
  it('shows an operator everything', () => {
    expect(visibleCatalog(buildCatalog(rows), 'operator')).toHaveLength(4);
  });

  it('shows a customer only external features', () => {
    const visible = visibleCatalog(buildCatalog(rows), 'customer');
    expect(visible).toHaveLength(2);
    expect(visible.every((e) => e.feature.manageability === 'external')).toBe(true);
  });
});
