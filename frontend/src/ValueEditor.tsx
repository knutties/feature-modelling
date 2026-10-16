interface Props {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

/**
 * The input is derived from the key's JSON schema, which is why the demo uses
 * an enum, a boolean and a bounded integer rather than three booleans: each
 * renders differently, and each gives Superposition something real to reject.
 */
export function ValueEditor({ schema, value, onChange, disabled }: Props) {
  const type = schema['type'];
  const options = schema['enum'] as unknown[] | undefined;

  if (options) {
    return (
      <select
        value={String(value ?? '')}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>{String(option)}</option>
        ))}
      </select>
    );
  }

  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (type === 'integer' || type === 'number') {
    return (
      <input
        type="number"
        value={value === undefined || value === null ? '' : String(value)}
        disabled={disabled}
        min={schema['minimum'] as number | undefined}
        max={schema['maximum'] as number | undefined}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? null : type === 'integer' ? Number.parseInt(raw, 10) : Number(raw));
        }}
      />
    );
  }

  return (
    <input
      value={value === undefined || value === null ? '' : String(value)}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
