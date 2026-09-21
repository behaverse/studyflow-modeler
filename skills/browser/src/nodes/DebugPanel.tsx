import type { DebugCard } from '@runner/debug';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';

/** The stand-in debug shows where a task or questionnaire would have run. */
export function DebugPanel({ card, onContinue }: { card: DebugCard; onContinue: () => void }) {
  const entries = Object.entries(card.details);
  return (
    <NodePanel>
      <span className={nodeStyles.subtitle}>would run &middot; {card.kind}</span>
      <h2 className={nodeStyles.title}>{card.name}</h2>
      {entries.length > 0 && (
        <dl className="text-sm text-stone-700 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-stone-500">{key}</dt>
              <dd className="font-mono break-all">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={nodeStyles.subtitle}>
        Debug: the screen is not mounted. Drop <code>debug</code> from the query string to run it.
      </p>
      <div className={nodeStyles.actions}>
        <button type="button" className={nodeStyles.primaryButton} onClick={onContinue}>
          Continue
        </button>
      </div>
    </NodePanel>
  );
}
