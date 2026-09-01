import { useState, type DragEvent } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { supportsFileSystemAccess } from '@modeler/diagram/fileHandle';
import { droppedHandle, openDiagramFile } from '@modeler/open/openFile';
import { extensionsOf, IMPORTABLE_FORMATS, JSPSYCH_EXTENSION } from '@modeler/export/formats';
import { radius, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

const s = {
  drop: `w-full flex flex-col items-center justify-center gap-2 px-6 py-12 ${radius.card}
         border-2 border-dashed transition-colors text-center cursor-pointer
         disabled:cursor-wait focus:outline-2 focus:outline-offset-2 focus:outline-cream-400`,
  dropIdle: 'border-black/[0.12] bg-cream-100 hover:border-black/[0.22] hover:bg-cream-200',
  dropActive: 'border-stone-900 bg-cream-200',
  dropIcon: 'text-[2rem] text-stone-400',
  dropTitle: `text-[13.5px] font-medium ${text.secondary}`,
  dropHint: 'text-[12px] text-stone-500',

  formats: 'mt-5 pt-4 border-t border-black/[0.06]',
  formatsLabel: 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-500 mb-2',
  list: 'space-y-1',
  row: 'flex items-baseline justify-between gap-4 text-[12.5px]',
  rowLabel: text.secondary,
  rowExt: 'font-mono text-[11.5px] text-stone-500 text-right',
  note: 'text-[12px] text-stone-500 mt-3 leading-snug',
} as const;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Opens the browser's own picker; owned by the palette, which keeps the fallback `<input>`. */
  onBrowse?: () => void;
};

export function OpenDialog({ isOpen, onClose, onBrowse }: Props) {
  const modeler = useRequiredModeler();
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
        <i className={`${busy ? ICONS.arrowRepeat + ' animate-spin' : ICONS.folderOpen} ${s.dropIcon}`}></i>
        <span className={s.dropTitle}>
          {busy ? 'Opening...' : 'Drop a file here, or click to browse'}
        </span>
        <span className={s.dropHint}>
          {supportsFileSystemAccess()
            ? 'A file opened this way keeps saving back to itself.'
            : 'This browser cannot write files back, so saving will download a copy.'}
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
          <li className={s.row}>
            <span className={s.rowLabel}>jsPsych timeline</span>
            <span className={s.rowExt}>{JSPSYCH_EXTENSION}</span>
          </li>
        </ul>
        <p className={s.note}>
          An SVG or PNG opens only if studyflow is embedded in it.
        </p>
      </div>
    </Modal>
  );
}
