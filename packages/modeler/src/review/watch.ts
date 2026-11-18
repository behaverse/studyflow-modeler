import { changedOnDisk, getLink, readFile } from '@modeler/diagram/fileHandle';
import { startReview } from '@modeler/review/commands';
import { getReview } from '@modeler/review/store';
import type { Editor } from '@modeler/editor/port';

/** How often the linked file is looked at while the page is in view. */
const LOOK_MS = 1500;

/**
 * Watch the linked file for a version something else writes into it (an assistant through `studyflow mcp`'s save,
 * another editor, a sync): when its modified time moves past the one the link last saw, and holds for one more look so
 * a write still under way is not read half done, the version comes in for review. Not while `busy` (a simulation, a
 * replay) or a review stands, and never while the canvas's own write is under way.
 */
export function attachReviewWatch(modeler: Editor, busy: () => boolean): () => void {
  let looking = false;
  /** A modified time seen once, waiting for the next look to find it still the newest. */
  let settling: number | undefined;

  const look = async (): Promise<void> => {
    if (looking || getReview() || busy() || document.visibilityState !== 'visible') return;
    const { file, state } = getLink();
    if (!file || state === 'saving' || state === 'blocked') return;
    looking = true;
    try {
      const onDisk = await readFile(file.handle);
      // Asked again after the read: a write of the canvas's own may have landed meanwhile.
      const now = getLink();
      if (!onDisk || now.file?.handle !== file.handle || now.state === 'saving' || !changedOnDisk(now.file, onDisk)) {
        settling = undefined;
        return;
      }
      if (settling !== onDisk.lastModified) {
        settling = onDisk.lastModified;
        return;
      }
      settling = undefined;
      await startReview(modeler, onDisk, now.file);
    } finally {
      looking = false;
    }
  };

  const onShown = (): void => { void look(); };
  const timer = window.setInterval(onShown, LOOK_MS);
  window.addEventListener('focus', onShown);
  document.addEventListener('visibilitychange', onShown);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', onShown);
    document.removeEventListener('visibilitychange', onShown);
  };
}
