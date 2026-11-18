import { CloseButton, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { ICONS } from '@modeler/icons';
import { useReview, type ReviewChange } from '@modeler/review/store';
import { review as s } from '@modeler/review/styles';

const KIND_ICONS: Record<ReviewChange['kind'], string> = { added: ICONS.added, changed: ICONS.changed, removed: ICONS.removed };
const KIND_NAMES: Record<ReviewChange['kind'], string> = { added: 'Added', changed: 'Changed', removed: 'Removed' };

/**
 * The composer's review face: a version written into the linked file elsewhere stands on the canvas, its new elements
 * and changed ones marked. The list says what each change did and shows the element; Accept keeps the version as one
 * step to undo, Discard puts the canvas's own back, for the next save to write into the file.
 */
export function ReviewFace() {
  const modeler = useModeler();
  const review = useReview();
  if (!review) return null;
  const count = review.changes.length;

  return (
    <>
      <span className={s.label}>
        <i className={ICONS.review} aria-hidden="true" />
        Review
      </span>
      <Popover className="flex min-w-0">
        <PopoverButton className={s.summary} title="What the version on disk changes" data-testid="review-changes">
          <span className="shrink-0">{count} {count === 1 ? 'change' : 'changes'} in</span>
          <span className={s.file}>{review.file}</span>
          <i className={`${ICONS.caretDown} ${s.caret}`} aria-hidden="true" />
        </PopoverButton>
        <PopoverPanel anchor="top start" className={s.list} data-testid="review-list">
          <div className={s.listHeader}>Changes on disk</div>
          {review.changes.map((change) => (
            <CloseButton
              key={`${change.kind}-${change.id}`}
              className={s.row}
              disabled={change.kind === 'removed'}
              title={change.kind === 'removed' ? `${KIND_NAMES.removed}: no longer in the study` : `${KIND_NAMES[change.kind]}: show it`}
              onClick={() => { void executeCommand(modeler, { type: 'GoToElement', id: change.id }); }}
            >
              <i className={`${KIND_ICONS[change.kind]} ${s.kind[change.kind]}`} aria-label={KIND_NAMES[change.kind]} />
              <span className={s.rowName}>{change.label}</span>
              <span className={s.rowWhat}>{change.kind === 'changed' && change.what.length > 0 ? change.what.join(', ') : change.type}</span>
            </CloseButton>
          ))}
        </PopoverPanel>
      </Popover>
      <span className="flex-1" />
      <button
        type="button"
        className={s.discard}
        title="Keep yours; the next save writes it"
        onClick={() => { void executeCommand(modeler, { type: 'DiscardReview' }); }}
      >
        Discard
      </button>
      <button
        type="button"
        className={s.accept}
        title="Keep the version on disk, as one step you can undo"
        onClick={() => { void executeCommand(modeler, { type: 'AcceptReview' }); }}
      >
        Accept
      </button>
    </>
  );
}
