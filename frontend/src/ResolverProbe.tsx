import { useState } from 'react';
import { type Persona, resolveAs } from './api.js';

interface Props {
  path: string[];
  persona: Persona;
}

/**
 * The payoff screen: the configuration as the APPLICATION sees it, read through
 * the OpenFeature provider rather than the control plane, with the cohort the
 * local-cohort dimension computed client-side.
 */
export function ResolverProbe({ path, persona }: Props) {
  const [customerId, setCustomerId] = useState('cust_001');
  const [killswitch, setKillswitch] = useState(false);
  const [result, setResult] = useState<
    { config: Record<string, unknown>; cohort: string; stale: boolean } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function probe(event: React.FormEvent) {
    event.preventDefault();
    try {
      setResult(await resolveAs(path, customerId, persona, killswitch));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResult(null);
    }
  }

  return (
    <form onSubmit={probe}>
      <h3>What the application sees</h3>
      <div className="row">
        <input
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          placeholder="customer id"
        />
        <label>
          <input
            type="checkbox"
            checked={killswitch}
            onChange={(event) => setKillswitch(event.target.checked)}
          />{' '}
          preview with kill switch engaged
        </label>
        <button type="submit">Resolve</button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div>
          {result.stale && (
            <p className="banner">
              Superposition was unreachable on the last read; these values may be stale.
            </p>
          )}
          <p className="hint">
            {path.join('/')} · customer <code>{customerId}</code> · cohort{' '}
            <code>{result.cohort}</code>
          </p>
          <table>
            <tbody>
              {Object.entries(result.config).map(([key, value]) => (
                <tr key={key}>
                  <td><code>{key}</code></td>
                  <td>{JSON.stringify(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
