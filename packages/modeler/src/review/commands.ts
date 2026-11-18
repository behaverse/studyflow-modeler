/**
 * Review: a version something else wrote into the linked file comes onto the canvas as one edit, read-only and marked
 * (what it added, what it changed), until the user accepts it, which keeps that edit as one undo step, or discards it,
 * which takes it back and lets the next save write the canvas's version over it.
 */
import { Study, type ChangedIds } from '@canvas/index.ts';
import { notify } from '@modeler/app/noticeStore';
import { holdAutosave } from '@modeler/diagram/autosave';
import { studyText } from '@modeler/diagram/commands';
import { markDiskVersion, type LinkedFile } from '@modeler/diagram/fileHandle';
import { describeChanges } from '@modeler/review/changes';
import { getReview, setReview, type Review } from '@modeler/review/store';
import type { Editor } from '@modeler/editor/port';

/** The canvas's marks for the version's elements: `sf-mark-review-added`, `sf-mark-review-changed` (modeler.css). */
const MARKS = { added: 'review-added', changed: 'review-changed' } as const;

/** Stops hearing the study's other changes while a review stands; set while one does. */
let stopHearing: (() => void) | undefined;
/** Set while a review takes back its own edit, so that undo is not heard as the user's. */
let settling = false;

function mark(modeler: Editor, review: Review, on: boolean): void {
  for (const kind of ['added', 'changed'] as const) {
    modeler.canvas.mark(review.changes.filter((change) => change.kind === kind).map((change) => change.id), MARKS[kind], on);
  }
}

/** The review is over, however it ended: the marks go, the canvas edits again, and auto-save writes what stands. */
function end(modeler: Editor, review: Review, link: { inSync: boolean } | undefined): void {
  stopHearing?.();
  stopHearing = undefined;
  mark(modeler, review, false);
  modeler.canvas.setEditable(true);
  setReview(undefined);
  if (link) markDiskVersion(review.modified, link);
  holdAutosave(false);
}

/**
 * Bring the version in `onDisk`, the linked file `file` as something else wrote it, onto the canvas for review. A
 * version that differs in nothing from the canvas's is taken quietly; one that cannot be read is said, and passed by.
 */
export async function startReview(modeler: Editor, onDisk: File, file: LinkedFile): Promise<void> {
  if (getReview()) return;
  const { study } = modeler;
  let ids: ChangedIds;
  let before: Study;
  holdAutosave(true);
  // A field being typed in commits when it loses the focus: let it commit now, under the version, rather than on top of
  // it once the review hides the inspector.
  const field = document.activeElement as HTMLElement | null;
  if (field && (field.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName))) {
    field.blur();
    await Promise.resolve();
  }
  try {
    const text = studyText(modeler, file.name, await onDisk.arrayBuffer());
    // The version standing now, kept to read what the new one changed of it.
    before = await Study.open(study.toYaml(), { metamodel: study.model.metamodel });
    const adopted = await study.adopt(text);
    if (!adopted.ok) throw new Error(adopted.reason);
    ids = adopted;
  } catch (err) {
    holdAutosave(false);
    // Passed by: the link moves on to it, so it is not read again, and the next save writes the canvas's version.
    markDiskVersion(onDisk.lastModified, { inSync: false });
    notify('error', `${file.name} changed on disk, but it could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const changes = describeChanges(ids, before, study);
  if (changes.length === 0) {
    holdAutosave(false);
    markDiskVersion(onDisk.lastModified, { inSync: true });
    return;
  }

  const review: Review = { file: file.name, modified: onDisk.lastModified, changes };
  modeler.canvas.select([]);
  modeler.canvas.setEditable(false);
  mark(modeler, review, true);
  setReview(review);
  // While it stands: an undo takes the version back, as Discard does; an edit (a command from the palette, say) builds on
  // it, so takes it, and the file is then behind; another study opened ends it.
  stopHearing = study.on('change', ({ cause }) => {
    if (settling) return;
    end(modeler, review, cause === 'load' ? undefined : { inSync: false });
  });
}

export type AcceptReviewCommand = { type: 'AcceptReview' };

/** Keep the version under review: the edit that brought it stays, one undo step, and the canvas matches the file. */
export function runAcceptReview(modeler: Editor, _command: AcceptReviewCommand): void {
  const review = getReview();
  if (review) end(modeler, review, { inSync: true });
}

export type DiscardReviewCommand = { type: 'DiscardReview' };

/** Turn the version under review down: the canvas goes back to its own, which the next save writes into the file. */
export function runDiscardReview(modeler: Editor, _command: DiscardReviewCommand): void {
  const review = getReview();
  if (!review) return;
  settling = true;
  try {
    modeler.study.undo();
  } finally {
    settling = false;
  }
  end(modeler, review, { inSync: false });
}
