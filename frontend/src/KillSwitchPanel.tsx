import { useCallback, useEffect, useState } from 'react';
import {
  type Feature, type Persona, disengageKillSwitch, engageKillSwitch,
  getEngagedKillSwitches,
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
 *
 * The standing banner is derived from the LIVE contexts, not from what this
 * component remembers doing. Held in component state alone it vanished on
 * reload and never appeared in a second tab, so the demo had a reachable state
 * in which an emergency override was active and nothing on screen said so -
 * and the feature table legitimately cannot say so either, since `viewFor`
 * always resolves with `killswitch: false`. An engaged kill switch is global
 * state, so it has to be read back as global state.
 */
export function KillSwitchPanel({ persona, features, onChanged }: Props) {
  const [key, setKey] = useState(features[0]?.key ?? '');
  const [value, setValue] = useState<unknown>(features[0]?.default);
  const [engaged, setEngaged] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadEngaged = useCallback(async () => {
    if (persona !== 'operator') return;
    try {
      setEngaged((await getEngagedKillSwitches(persona)).engaged);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [persona]);

  // On mount, so a switch engaged in another tab or before a reload still
  // shows its banner. Engage and disengage re-read as well, below.
  useEffect(() => {
    void loadEngaged();
  }, [loadEngaged]);

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
      // Optimistic, then confirmed against the contexts.
      setEngaged((current) => (current.includes(key) ? current : [...current, key]));
      setError(null);
      onChanged();
      await loadEngaged();
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
      await loadEngaged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div>
      {engaged.length > 0 && (
        <div className="banner">
          Kill switch engaged for {engaged.join(', ')}. Entity overrides are
          untouched; disengaging restores them exactly. The feature table still
          shows the configured value — it resolves with{' '}
          <code>killswitch: false</code> — so resolve with the kill switch
          previewed to see what the application gets.
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
