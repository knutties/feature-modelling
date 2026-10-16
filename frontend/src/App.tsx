import { useCallback, useEffect, useState } from 'react';
import { type EntityNode, type Feature, type Persona, getCatalog, getEntities } from './api.js';
import { CohortPanel } from './CohortPanel.js';
import { EntityFeatures } from './EntityFeatures.js';
import { Hierarchy } from './Hierarchy.js';
import { KillSwitchPanel } from './KillSwitchPanel.js';
import { ResolverProbe } from './ResolverProbe.js';

export function App() {
  const [persona, setPersona] = useState<Persona>('operator');
  const [tree, setTree] = useState<EntityNode[]>([]);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ features: Feature[]; cohorts: string[] }>({
    features: [], cohorts: [],
  });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setTree((await getEntities()).tree);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    getCatalog(persona).then(setCatalog).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [persona]);

  return (
    <main>
      <header>
        <h1>Feature modelling with Superposition</h1>
        <div className="persona">
          {(['operator', 'customer'] as Persona[]).map((option) => (
            <button
              key={option}
              className={persona === option ? 'active' : ''}
              onClick={() => setPersona(option)}
            >
              {option === 'operator' ? 'Platform operator' : 'Customer'}
            </button>
          ))}
        </div>
        <p className="hint">
          {persona === 'operator'
            ? 'Seeing internal and external features.'
            : 'Seeing only external features — internal configuration is not returned by the API at all.'}
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="layout">
        <Hierarchy
          tree={tree}
          selected={selected}
          onSelect={setSelected}
          onChanged={refresh}
        />
        <div className="detail">
          {selected
            ? <EntityFeatures key={version} path={selected} persona={persona} />
            : <p className="hint">Select an entity, or create one.</p>}
          <KillSwitchPanel
            persona={persona}
            features={catalog.features}
            onChanged={() => setVersion((n) => n + 1)}
          />
          {selected && (
            <>
              <CohortPanel
                path={selected}
                persona={persona}
                cohorts={catalog.cohorts}
                features={catalog.features}
              />
              <ResolverProbe path={selected} persona={persona} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
