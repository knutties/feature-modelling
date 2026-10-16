import type { TimelineItem } from './api.js';

/**
 * One resolution timeline from `GetResolvedConfigExplanation`: every context
 * that applied, in the order the resolver applied them, with its condition,
 * **its priority** and the value before and after it.
 *
 * The priority column is the point. The whole model rests on one piece of
 * arithmetic — a context's weight is Σ2^position over the dimensions it names
 * and the highest wins — so a timeline showing the contexts without their
 * weights would show the cascade's effect while hiding its cause. The weights
 * rise monotonically down the list, which is why the last row is the one that
 * decided the value.
 */
export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="hint">No context applied — this is the workspace default.</p>;
  }
  return (
    <div>
      {items.map((item, index) => (
        <div className="timeline" key={item.context_id}>
          <span className="weight" title="Σ2^position over the dimensions this context names">
            priority {item.weight}
          </span>{' '}
          {index + 1}. <code>{JSON.stringify(item.condition)}</code>{' '}
          changed {JSON.stringify(item.value_before)} to {JSON.stringify(item.value_after)}
        </div>
      ))}
      <p className="hint">
        Priority is Σ2^position over the dimensions a context names, and the
        highest wins — so the last row above is the one that decided the value.
      </p>
    </div>
  );
}
