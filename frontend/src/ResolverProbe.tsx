import { useState } from 'react';
import { type Persona, type TimelineItem, explainFeature, resolveAs } from './api.js';
import { Timeline } from './Timeline.js';

interface Props {
  path: string[];
  persona: Persona;
}

/** What the last Resolve asked for, so an expanded timeline explains that read. */
interface Probed {
  customerId: string;
  killswitch: boolean;
  config: Record<string, unknown>;
  cohort: string;
  stale: boolean;
}

/**
 * The payoff screen: the configuration as the APPLICATION sees it, read through
 * the OpenFeature provider rather than the control plane, with the cohort the
 * local-cohort dimension computed client-side.
 *
 * Expanding a key shows that key's resolution timeline for *this* read — the
 * customer and kill-switch state just probed, not the entity's configured
 * view. That is what makes the cascade's two highest-weight rows observable:
 * the cohort context at weight 30 only matches a query carrying a
 * `customer_id`, and the kill-switch context at weight 64 only matches one
 * carrying `killswitch: true`. The feature table's own timeline asks for
 * neither, by design, so until a timeline existed here the cohort and the kill
 * switch could change a value with no screen able to show which context did it.
 */
export function ResolverProbe({ path, persona }: Props) {
  const [customerId, setCustomerId] = useState('cust_001');
  const [killswitch, setKillswitch] = useState(false);
  const [result, setResult] = useState<Probed | null>(null);
  const [timelines, setTimelines] = useState<Record<string, TimelineItem[]>>({});
  const [error, setError] = useState<string | null>(null);

  async function probe(event: React.FormEvent) {
    event.preventDefault();
    try {
      const view = await resolveAs(path, customerId, persona, killswitch);
      setResult({ ...view, customerId, killswitch });
      // The timelines on screen explained the previous read; drop them rather
      // than leave them next to values they no longer describe.
      setTimelines({});
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResult(null);
      setTimelines({});
    }
  }

  async function toggleWhy(key: string, probed: Probed) {
    if (timelines[key]) {
      const next = { ...timelines };
      delete next[key];
      setTimelines(next);
      return;
    }
    try {
      const { timeline } = await explainFeature(path, key, {
        customerId: probed.customerId,
        killswitch: probed.killswitch,
      });
      setTimelines({ ...timelines, [key]: timeline });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
            {path.join('/')} · customer <code>{result.customerId}</code> · cohort{' '}
            <code>{result.cohort}</code>
            {result.killswitch && <> · kill switch previewed as engaged</>}
          </p>
          <table>
            <tbody>
              {Object.entries(result.config).map(([key, value]) => (
                <tr key={key}>
                  <td>
                    <code>{key}</code>
                    <div>
                      <button
                        type="button"
                        className="link"
                        onClick={() => void toggleWhy(key, result)}
                      >
                        {timelines[key] ? 'hide why' : 'why?'}
                      </button>
                    </div>
                    {timelines[key] && <Timeline items={timelines[key]!} />}
                  </td>
                  <td>{JSON.stringify(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Each timeline is the resolution for exactly this read — customer{' '}
            <code>{result.customerId}</code>, kill switch{' '}
            {result.killswitch ? 'engaged' : 'disengaged'} — so the cohort
            context (priority 30) and the kill-switch context (priority 64)
            appear here and nowhere else.
          </p>
        </div>
      )}
    </form>
  );
}
