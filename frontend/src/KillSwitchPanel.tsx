import { useEffect, useState } from 'react';
import {
  type Feature, type Persona, disengageKillSwitch, engageKillSwitch,
} from './api.js';
import { ValueEditor } from './ValueEditor.js';

interface Props {
  persona: Persona;
  features: Feature[];
  onChanged: () => void;
}

/**
 * Operator-only. Writes one context at weight 64, above the 62 that every other
 * dimension sums to, so it overrides the feature everywhere at once while every
 * entity override stays on disk - disengaging therefore restores the previous
 * world exactly.
 */
export function KillSwitchPanel({ persona, features, onChanged }: Props) {
  const [key, setKey] = useState(features[0]?.key ?? '');
  const [value, setValue] = useState<unknown>(features[0]?.default);
  const [engaged, setEngaged] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // `features` arrives empty on first mount (the catalog fetch in App.tsx is
  // async and this panel mounts unconditionally), and a useState initializer
  // only runs once - so resync key/value once the real catalog lands, but
  // only when the current key is no longer present, so a re-render that
  // merely re-creates the same array does not stomp a selection in progress.
  useEffect(() => {
    if (!features.some((candidate) => candidate.key === key)) {
      setKey(features[0]?.key ?? '');
      setValue(features[0]?.default);
    }
  }, [features]);

  if (persona !== 'operator') return null;
  const feature = features.find((candidate) => candidate.key === key);

  async function engage(event: React.FormEvent) {
    event.preventDefault();
    try {
      await engageKillSwitch(key, value, persona);
      setEngaged((current) => (current.includes(key) ? current : [...current, key]));
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function disengage(target: string) {
    try {
      await disengageKillSwitch(target, persona);
      setEngaged((current) => current.filter((item) => item !== target));
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div>
      {engaged.length > 0 && (
        <div className="banner">
          Kill switch engaged for {engaged.join(', ')}. Entity overrides are
          untouched; disengaging restores them exactly.
        </div>
      )}
      <form onSubmit={engage}>
        <h3>Kill switch (operators only)</h3>
        <div className="row">
          <select
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setValue(features.find((f) => f.key === event.target.value)?.default);
            }}
          >
            {features.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
          </select>
          {feature && (
            <ValueEditor schema={feature.schema} value={value} onChange={setValue} />
          )}
          <button type="submit" disabled={!feature}>Engage</button>
        </div>
        <p className="hint">
          The emergency value defaults to the platform default — the conservative
          choice — but any schema-valid value is allowed, since the requirement is
          wholesale modification, not only restoring the default.
        </p>
        <p className="hint">
          Writes one context at weight 64, above the 62 that every other
          dimension sums to — so a single row overrides the feature everywhere
          at once, while every entity override stays on disk untouched.
        </p>
      </form>
      {engaged.map((item) => (
        <button key={item} className="link" onClick={() => void disengage(item)}>
          Disengage {item}
        </button>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
