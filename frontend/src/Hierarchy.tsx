import { useState } from 'react';
import {
  type CopyReport, type EntityNode, type SkipReport, createEntity, retryEntity,
} from './api.js';

const CHILD_LEVEL: Record<string, string | undefined> = {
  org: 'merchant',
  merchant: 'profile',
  profile: undefined,
};

interface Props {
  tree: EntityNode[];
  selected: string[] | null;
  onSelect: (path: string[]) => void;
  onChanged: () => void;
}

interface Report {
  path: string[];
  copied: CopyReport[];
  skipped: SkipReport[];
}

export function Hierarchy({ tree, selected, onSelect, onChanged }: Props) {
  const [parent, setParent] = useState<string[]>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const childLevel = parent.length === 0 ? 'org' : CHILD_LEVEL[levelAt(parent.length)];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const path = [...parent, id];
      const result = await createEntity(path, name || id);
      setReport({ path, copied: result.copied, skipped: result.skipped });
      setError(null);
      setId('');
      setName('');
      onChanged();
      onSelect(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setReport(null);
    }
  }

  /**
   * Re-run provisioning for an entity whose creation failed part-way. The
   * spec's error handling promises a retry for `provisioning_failed`, and
   * `Provisioner.retry` has always existed - but with no button and no route
   * it was unreachable, and re-creating the entity returns 409, so a failed
   * entity could only be repaired by hand-editing the entity store.
   */
  async function retry(path: string[]) {
    try {
      const result = await retryEntity(path);
      setReport({ path, copied: result.copied, skipped: result.skipped });
      setError(null);
      onChanged();
      onSelect(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setReport(null);
    }
  }

  return (
    <aside className="hierarchy">
      <h2>Entities</h2>
      <Nodes
        nodes={tree}
        selected={selected}
        onSelect={onSelect}
        onAddUnder={setParent}
        onRetry={retry}
      />

      {childLevel && (
        <form onSubmit={submit}>
          <h3>
            New {childLevel}
            {parent.length > 0 && <> under {parent.join('/')}</>}
          </h3>
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="id (letters, digits, - and _)"
            required
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="display name"
          />
          <div className="row">
            <button type="submit">Create</button>
            {parent.length > 0 && (
              <button type="button" onClick={() => setParent([])}>
                Create a new org instead
              </button>
            )}
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {report && (
        <div className="report">
          <h3>Provisioned {report.path.join('/')}</h3>
          <h4>Copies frozen from the parent</h4>
          {report.copied.length === 0
            ? <p className="hint">None — every feature at this level inherits.</p>
            : (
              <ul>
                {report.copied.map((copy) => (
                  <li key={copy.key}>
                    <code>{copy.key}</code> = {JSON.stringify(copy.value)}
                    {copy.fromPath.length > 0
                      ? <> from {copy.fromPath.join('/')}</>
                      : <> from the workspace default</>}
                  </li>
                ))}
              </ul>
            )}
          <h4>Copied features deliberately not written here</h4>
          {report.skipped.length === 0
            ? <p className="hint">None.</p>
            : (
              <ul>
                {report.skipped.map((skip) => (
                  <li key={skip.key}>
                    <code>{skip.key}</code> — {skip.reason}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </aside>
  );
}

function levelAt(depth: number): string {
  return ['org', 'merchant', 'profile'][depth - 1] ?? 'profile';
}

function Nodes({
  nodes, selected, onSelect, onAddUnder, onRetry,
}: {
  nodes: EntityNode[];
  selected: string[] | null;
  onSelect: (path: string[]) => void;
  onAddUnder: (path: string[]) => void;
  onRetry: (path: string[]) => void;
}) {
  if (nodes.length === 0) return <p className="hint">No entities yet.</p>;
  return (
    <ul className="tree">
      {nodes.map((node) => {
        const isSelected = selected?.join('~') === node.entity.path.join('~');
        return (
          <li key={node.entity.path.join('~')}>
            <span className={isSelected ? 'node selected' : 'node'}>
              <button className="link" onClick={() => onSelect(node.entity.path)}>
                {node.entity.name} <small>{node.entity.level}</small>
              </button>
              {node.entity.provisioningState === 'provisioning_failed' && (
                <>
                  <span className="warn" title="provisioning failed">!</span>
                  <button
                    className="link"
                    title="Re-run provisioning for this entity"
                    onClick={() => onRetry(node.entity.path)}
                  >
                    Retry
                  </button>
                </>
              )}
              {node.entity.level !== 'profile' && (
                <button className="link" onClick={() => onAddUnder(node.entity.path)}>+</button>
              )}
            </span>
            <Nodes
              nodes={node.children}
              selected={selected}
              onSelect={onSelect}
              onAddUnder={onAddUnder}
              onRetry={onRetry}
            />
          </li>
        );
      })}
    </ul>
  );
}
