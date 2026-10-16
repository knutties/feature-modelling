import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  type FeatureView, type Persona, type TimelineItem,
  explainFeature, getFeatures, revertFeature, setFeature,
} from './api.js';
import { ValueEditor } from './ValueEditor.js';

interface Props {
  path: string[];
  persona: Persona;
  onChanged?: () => void;
}

function propagationLabel(view: FeatureView): string {
  if (view.propagation.kind === 'inherited') return 'inherited';
  return view.propagation.till === 'profile'
    ? 'copied (every level)'
    : `copied till ${view.propagation.till}`;
}

export function EntityFeatures({ path, persona, onChanged }: Props) {
  const [views, setViews] = useState<FeatureView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [timelines, setTimelines] = useState<Record<string, TimelineItem[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { features } = await getFeatures(path, persona);
      setViews(features);
      setDrafts({});
      setTimelines({});
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [path.join('~'), persona]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(view: FeatureView) {
    setBusy(true);
    try {
      await setFeature(path, view.key, drafts[view.key], persona);
      await load();
      onChanged?.();
    } catch (cause) {
      // Superposition's own validation message, verbatim.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revert(view: FeatureView) {
    setBusy(true);
    try {
      await revertFeature(path, view.key, persona);
      await load();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggleExplain(view: FeatureView) {
    if (timelines[view.key]) {
      const next = { ...timelines };
      delete next[view.key];
      setTimelines(next);
      return;
    }
    try {
      const { timeline } = await explainFeature(path, view.key);
      setTimelines({ ...timelines, [view.key]: timeline });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div>
      <h2>{path.join('/')}</h2>
      {persona === 'customer' && (
        <p className="hint">
          Internal features are not in this response at all — the server filters
          them at the resolve call, not in the browser.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Class</th>
            <th>Value</th>
            <th>Where it came from</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {views.map((view) => {
            const dirty = view.key in drafts;
            return (
              <Fragment key={view.key}>
                <tr>
                  <td>
                    <code>{view.name}</code>
                    <div className="hint">{view.description}</div>
                  </td>
                  <td>
                    <span className={`badge ${view.manageability}`}>{view.manageability}</span>
                    <div className="hint">{propagationLabel(view)}</div>
                  </td>
                  <td>
                    <ValueEditor
                      schema={view.schema}
                      value={dirty ? drafts[view.key] : view.value}
                      disabled={busy}
                      onChange={(value) => setDrafts({ ...drafts, [view.key]: value })}
                    />
                  </td>
                  <td>
                    {view.provenanceLabel}
                    <div>
                      <button className="link" onClick={() => void toggleExplain(view)}>
                        {timelines[view.key] ? 'hide why' : 'why?'}
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="row">
                      <button disabled={!dirty || busy} onClick={() => void save(view)}>
                        Save
                      </button>
                      <button
                        className="link"
                        disabled={busy || view.provenance.kind !== 'own'}
                        title={
                          view.provenance.kind === 'own'
                            ? 'Drop this entity value and inherit again'
                            : 'Nothing of its own to revert'
                        }
                        onClick={() => void revert(view)}
                      >
                        Revert
                      </button>
                    </div>
                  </td>
                </tr>
                {timelines[view.key] && (
                  <tr>
                    <td colSpan={5}>
                      <Timeline items={timelines[view.key]!} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="hint">No context applied — this is the workspace default.</p>;
  }
  return (
    <div>
      {items.map((item, index) => (
        <div className="timeline" key={item.context_id}>
          {index + 1}. <code>{JSON.stringify(item.condition)}</code>{' '}
          changed {JSON.stringify(item.value_before)} to {JSON.stringify(item.value_after)}
        </div>
      ))}
    </div>
  );
}
