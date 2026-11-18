import { useState, type DragEvent } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { droppedHandle, openDiagramFile } from '@modeler/open/openFile';
import { extensionsOf, IMPORTABLE_FORMATS, OPENERS } from '@modeler/diagram/formats';
import { radius, sectionLabel, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

const s = {
  drop: `w-full flex flex-col items-center justify-center gap-2 px-6 py-12 ${radius.card}
         border-2 border-dashed transition-colors text-center cursor-pointer
         disabled:cursor-wait focus:outline-none focus:ring-[3px] focus:ring-accent/30`,
  dropIdle: 'border-black/[0.12] bg-field hover:border-black/[0.22] hover:bg-white',
  dropActive: 'border-accent bg-accent/[0.06]',
  dropIcon: 'text-[2rem] text-stone-400',
  dropTitle: `text-sm font-medium ${text.secondary}`,

  formats: 'mt-4 pt-4 border-t border-black/[0.10]',
  formatsLabel: `${sectionLabel} mb-2`,
  list: 'space-y-1',
  row: 'flex items-baseline justify-between gap-4 text-xs',
  rowLabel: text.secondary,
  rowExt: 'font-mono text-[0.6875rem] text-stone-500 text-right',
} as const;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Opens the browser's own picker; owned by the palette, which keeps the fallback `<input>`. */
  onBrowse?: () => void;
};

export function OpenDialog({ isOpen, onClose, onBrowse }: Props) {
  const modeler = useModeler();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setOver(false);
    const item = e.dataTransfer.items?.[0];
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      // A dropped file can carry a handle in Chromium, which is what makes it savable afterwards.
      const handle = item ? await droppedHandle(item) : undefined;
      if (await openDiagramFile(modeler, file, handle)) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Open" size="sm" testId="open-dialog">
      <button
        type="button"
        data-testid="open-dropzone"
        onClick={onBrowse}
        disabled={busy}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { void handleDrop(e); }}
        className={`${s.drop} ${over ? s.dropActive : s.dropIdle}`}
      >
        <i className={`${busy ? ICONS.spinner + ' animate-spin' : ICONS.folderOpen} ${s.dropIcon}`}></i>
        <span className={s.dropTitle}>
          {busy ? 'Opening...' : 'Drop a file here, or click to browse'}
        </span>
      </button>

      <div className={s.formats}>
        <div className={s.formatsLabel}>Opens</div>
        <ul className={s.list}>
          {IMPORTABLE_FORMATS.map((format) => (
            <li key={format.id} className={s.row}>
              <span className={s.rowLabel}>{format.label}</span>
              <span className={s.rowExt}>{extensionsOf(format).join(' ')}</span>
            </li>
          ))}
          {OPENERS.map((opener) => (
            <li key={opener.extension} className={s.row}>
              <span className={s.rowLabel}>{opener.label}</span>
              <span className={s.rowExt}>{opener.extension}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
