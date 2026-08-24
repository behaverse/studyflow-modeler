import { useSyncExternalStore } from 'react';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { getLink, reconnectLink, subscribeLink, type LinkState } from '@modeler/diagram/fileHandle';
import { autoSavable } from '@modeler/export/formats';
import { MOD_LABEL } from '@modeler/constants';
import { ICONS } from '@modeler/icons';
import { radius, text } from '@modeler/ui/styles';

const s = {
  chip: `inline-flex items-center gap-1.5 max-w-[40vw] md:max-w-[220px] px-2 py-1 ${radius.field}
         text-[12px] ${text.muted} hover:bg-black/[0.05] transition-colors cursor-pointer`,
  name: 'font-mono truncate',
  icon: 'shrink-0 text-[11px]',
  spinner: 'shrink-0 text-[11px] animate-spin',
  dot: 'shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500',
  attention: 'text-amber-600',
} as const;

/** What the chip says about a file, per state. `@` is the linked filename. */
const EXPLANATION: Record<LinkState, string> = {
  clean: 'Saved to @. Edits are written straight back into it.',
  dirty: `Unsaved edits. ${MOD_LABEL}S writes them into @.`,
  saving: 'Writing @...',
  conflict: '@ changed on disk. Click to replace it with what is on the canvas.',
  blocked: 'Reopened in a new session: click to let this page write @ again.',
  error: 'The last write to @ failed. Click to try again.',
};

/** Rendering an image is far too slow to repeat per edit, so those links never auto-save. */
const IMAGE_NEEDS_EXPLICIT_SAVE = `Unsaved edits. Rendering an image is too slow to repeat on every edit, so ${MOD_LABEL}S writes @.`;

export function FileStatus() {
  const modeler = useRequiredModeler();
  const link = useSyncExternalStore(subscribeLink, getLink, getLink);
  const file = link.file;

  // Nothing is linked until a file is opened or saved through a picker; there is no chip to show.
  if (!file) return null;

  const explanation = (link.state === 'dirty' && !autoSavable(file.format)
    ? IMAGE_NEEDS_EXPLICIT_SAVE
    : EXPLANATION[link.state]
  ).replaceAll('@', file.name);

  const needsAttention = link.state === 'conflict' || link.state === 'blocked' || link.state === 'error';

  const save = async () => {
    // Permission has to be re-granted from inside this click; `SaveDiagram` alone cannot ask.
    if (link.state === 'blocked' && !(await reconnectLink())) return;
    await executeCommand(modeler, { type: 'SaveDiagram' });
  };

  return (
    <button
      type="button"
      onClick={() => { void save(); }}
      data-testid="file-status"
      data-file-state={link.state}
      title={link.message ?? explanation}
      className={`${s.chip} ${needsAttention ? s.attention : ''}`}
    >
      <span className={s.name}>{file.name}</span>
      {link.state === 'saving' && <i className={`${ICONS.arrowRepeat} ${s.spinner}`} aria-hidden="true" />}
      {link.state === 'clean' && <i className={`${ICONS.check} ${s.icon}`} aria-hidden="true" />}
      {link.state === 'dirty' && <span className={s.dot} aria-hidden="true" />}
      {link.state === 'blocked' && <i className={`${ICONS.unlock} ${s.icon}`} aria-hidden="true" />}
      {needsAttention && link.state !== 'blocked' && <i className={`${ICONS.warning} ${s.icon}`} aria-hidden="true" />}
      <span className="sr-only">{explanation}</span>
    </button>
  );
}
