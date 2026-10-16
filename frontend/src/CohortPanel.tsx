import { useEffect, useState } from 'react';
import { type Feature, type Persona, setCohortFeature } from './api.js';
import { ValueEditor } from './ValueEditor.js';

interface Props {
  path: string[];
  persona: Persona;
  cohorts: string[];
  features: Feature[];
}

/**
 * Cohort specialization is an explicit override at weight 30, above any entity
 * path's 14 - so it behaves identically for inherited and copied features.
 * That is worth stating on screen, because the model invites the question.
 */
export function CohortPanel({ path, persona, cohorts, features }: Props) {
  const [cohort, setCohort] = useState(cohorts[0] ?? '');
  const [key, setKey] = useState(features[0]?.key ?? '');
  const [value, setValue] = useState<unknown>(features[0]?.default);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `features` arrives empty on first mount in the same race as the kill
  // switch panel - resync key/value once the real catalog lands, but only
  // when the current key is no longer present, so a re-render that merely
  // re-creates the same array does not stomp a selection in progress.
  useEffect(() => {
    if (!features.some((candidate) => candidate.key === key)) {
      setKey(features[0]?.key ?? '');
      setValue(features[0]?.default);
    }
  }, [features]);

  // `cohorts` arrives empty on the same first-mount race - resync the
  // cohort selection too, with the identical absent-only guard.
  useEffect(() => {
    if (!cohorts.includes(cohort)) setCohort(cohorts[0] ?? '');
  }, [cohorts]);

  const feature = features.find((candidate) => candidate.key === key);
  if (path.length !== 3) {
    return <p className="hint">Select a profile to specialize a feature for a cohort.</p>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await setCohortFeature(path, cohort, key, value, persona);
      setStatus(`${key} = ${JSON.stringify(value)} for cohort ${cohort}`);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus(null);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>Specialize for a customer cohort</h3>
      <div className="row">
        <select value={cohort} onChange={(event) => setCohort(event.target.value)}>
          {cohorts.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
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
        <button type="submit" disabled={!cohort || !feature}>Set</button>
      </div>
      <p className="hint">
        Writes a context at weight 30, which outranks this profile's own 14 — so
        it applies the same way whether the feature is inherited or copied.
      </p>
      {status && <p className="hint">{status}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
