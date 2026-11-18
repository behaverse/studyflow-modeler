import { createContext, createElement, useCallback, useContext, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useModeler } from '@modeler/app/useModeler';
import { useDiagramPicker } from '@modeler/open/openFile';
import { GalleryDialog } from '@modeler/gallery/Gallery';
import { OpenDialog } from '@modeler/open/Open';
import { SaveDialog } from '@modeler/export/Save';
import { ManuscriptDialog } from '@modeler/manuscript/Manuscript';
import { ReportingDialog } from '@modeler/reporting/Reporting';

/** The app's dialogs, opened from the command palette, a key, or the nav bar's file card. */
export type DialogId = 'gallery' | 'open' | 'save' | 'manuscript' | 'reporting';

type DialogProps = { isOpen: boolean; onClose: () => void; scopeId?: string; onBrowse?: () => void };

const DIALOGS: Record<DialogId, ComponentType<DialogProps>> = {
  gallery: GalleryDialog,
  open: OpenDialog,
  save: SaveDialog,
  manuscript: ManuscriptDialog,
  reporting: ReportingDialog,
};

type ShownDialog = { id: DialogId; scopeId?: string };

const DialogContext = createContext<{
  dialog: ShownDialog | null;
  openDialog: (id: DialogId, scopeId?: string) => void;
  closeDialog: () => void;
}>({ dialog: null, openDialog: () => {}, closeDialog: () => {} });

export const useDialogs = () => useContext(DialogContext);

/** Which dialog is open, for everything inside to read and change. One shows at a time. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ShownDialog | null>(null);
  const openDialog = useCallback((id: DialogId, scopeId?: string) => setDialog({ id, scopeId }), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const value = useMemo(() => ({ dialog, openDialog, closeDialog }), [dialog, openDialog, closeDialog]);
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

/**
 * The open dialog, and the hidden file input a pick falls back to where the browser has no picker. The input stays
 * mounted: the CLI and the e2e specs drive it (`open-file-input`).
 */
export function DialogHost() {
  const modeler = useModeler();
  const { dialog, closeDialog } = useDialogs();
  // The pick may have been started from the Open dialog, which has nothing left to say once a file opens.
  const diagramPicker = useDiagramPicker(modeler, closeDialog);

  return (
    <>
      {/* Only the open dialog is mounted: mounting them all runs every dialog's hooks on boot. */}
      {dialog && createElement(DIALOGS[dialog.id], {
        isOpen: true,
        onClose: closeDialog,
        scopeId: dialog.scopeId,
        onBrowse: diagramPicker.open,
      })}
      <input {...diagramPicker.inputProps} />
    </>
  );
}
