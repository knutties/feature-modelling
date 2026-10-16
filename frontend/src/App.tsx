import { useCallback, useEffect, useState } from 'react';
import { type EntityNode, type Persona, getEntities } from './api.js';
import { Hierarchy } from './Hierarchy.js';

export function App() {
  const [persona, setPersona] = useState<Persona>('operator');
  const [tree, setTree] = useState<EntityNode[]>([]);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            ? <p className="hint">Entity selected: {selected.join('/')} — feature table arrives in Task 12.</p>
            : <p className="hint">Select an entity, or create one.</p>}
        </div>
      </section>
    </main>
  );
}
