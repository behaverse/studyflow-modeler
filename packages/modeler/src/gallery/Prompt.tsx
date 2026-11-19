import { ICONS } from '@modeler/icons';
import { radius, space } from '@modeler/ui/styles';

const s = {
  box: `flex flex-col gap-2 p-3 shrink-0 ${radius.card} border border-black/[0.14] bg-field/60 cursor-not-allowed`,
  input: `w-full h-10 resize-none bg-transparent text-sm text-stone-900 placeholder-stone-400
          focus:outline-none disabled:cursor-not-allowed`,
  foot: 'flex items-center justify-between gap-2',
  note: 'flex items-center gap-2 min-w-0 text-xs text-stone-500',
  soon: `${space.token} ${radius.button} bg-black/[0.05] text-stone-500`,
  send: `inline-flex items-center justify-center size-7 ${radius.pill} bg-black/[0.08] text-stone-400`,
} as const;

/**
 * Where a study or an analysis will be described in words for a model to write. Nothing reads it yet, so it is
 * disabled, and says so.
 */
export function Prompt() {
  return (
    <div className={s.box} data-testid="new-prompt">
      <textarea
        disabled
        aria-label="Describe a study or an analysis"
        placeholder="Describe a study or an analysis..."
        className={s.input}
      />
      <div className={s.foot}>
        <span className={s.note}>
          <span className={s.soon}>Soon</span>
          Use a template below
        </span>
        <button type="button" disabled aria-label="Create from the description" className={s.send}>
          <i className={ICONS.moveUp} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
