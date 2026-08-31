import { Dialog, DialogPanel } from '@headlessui/react';
import {
  createElement,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useSyncExternalStore,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ReplayContext, SettingsViewContext } from '@modeler/app/contexts';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { MOD_LABEL } from '@modeler/constants';
import { DIAGRAM_OPEN_ACCEPT, getLinkedFileName, linkOpenedFile, subscribeLink } from '@modeler/diagram/fileHandle';
import { saveLinkedFile } from '@modeler/diagram/save';
import { commandPalette as cp } from '@modeler/commandPalette/styles';
import { OPENABLE_EXTENSIONS } from '@modeler/export/formats';
import { isBinaryDiagram, isOpenable, OPEN_FAILURE_MESSAGE, OPEN_INVALID_MESSAGE } from '@modeler/open/openFile';
import { GalleryDialog } from '@modeler/gallery/Gallery';
import { OpenDialog } from '@modeler/open/Open';
import { SaveDialog } from '@modeler/export/Save';
import { ChecklistDialog } from '@modeler/checklist/Checklist';
import { GanttDialog } from '@modeler/gantt/Gantt';
import { ProvenanceDialog } from '@modeler/provenance/Provenance';
import { buildPaletteCommands } from '@modeler/commandPalette/menu';
import {
  findCommand,
  groupCommands,
  searchCommands,
  type PaletteCommand,
  type PaletteDialogId,
} from '@modeler/commandPalette/types';
import { useFilePicker } from '@modeler/commandPalette/useFilePicker';
import { ICONS } from '@modeler/icons';

type SubDialogProps = { isOpen: boolean; onClose: () => void; scopeId?: string; onBrowse?: () => void };

const SUB_DIALOGS: Record<PaletteDialogId, ComponentType<SubDialogProps>> = {
  gallery: GalleryDialog,
  open: OpenDialog,
  save: SaveDialog,
  checklist: ChecklistDialog,
  gantt: GanttDialog,
  provenance: ProvenanceDialog,
};

// Structural, so both React's synthetic events and raw window KeyboardEvents fit.
type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

function isBareKey(e: KeyPress, key: string): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export const OPEN_PALETTE_SHORTCUT_LABEL = `${MOD_LABEL}K`;

type Props = {
  ref?: React.Ref<{ open: () => void; close: () => void }>;
};

export function CommandPalette({ ref }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ id: PaletteDialogId; scopeId?: string } | null>(null);
  const modeler = useRequiredModeler();
  const { openSettings } = useContext(SettingsViewContext);
  const { openReplay } = useContext(ReplayContext);
  const isSimulating = useIsSimulating(modeler);
  // A string selector, so the palette does not re-render through every save state transition.
  const linkedFileName = useSyncExternalStore(subscribeLink, getLinkedFileName, getLinkedFileName);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const diagramPicker = useFilePicker({
    accept: OPENABLE_EXTENSIONS.join(','),
    picker: DIAGRAM_OPEN_ACCEPT,
    // Links the picked file, so from here on saving writes back into it instead of downloading.
    onPicked: linkOpenedFile,
    testId: 'open-file-input',
    isValid: isOpenable,
    invalidMessage: OPEN_INVALID_MESSAGE,
    isBinary: isBinaryDiagram,
    failureMessage: OPEN_FAILURE_MESSAGE,
    onText: async (filename, content) => {
      if (content == null) throw new Error('Could not read the file. Try again.');
      const result = await executeCommand(modeler, { type: 'OpenDiagram', filename, content });
      // The pick may have been started from the Open dialog, which has nothing left to say.
      setDialog(null);
      return result;
    },
  });

  const open = () => {
    setQuery('');
    setActiveIndex(0);
    setSubmenuId(null);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useImperativeHandle(ref, () => ({ open, close }), []);

  const commands = useMemo(
    () =>
      buildPaletteCommands({
        modeler,
        isSimulating,
        openSettings,
        // Palette-opened dialogs are unscoped; only the `p`-on-selection path sets a provenance scope.
        openDialog: (id: PaletteDialogId) => setDialog({ id }),
        openReplay,
        linkedFileName,
      }),
    [modeler, openSettings, isSimulating, openReplay, linkedFileName],
  );

  const submenuParent = useMemo(
    () => (submenuId ? findCommand(commands, submenuId) : null),
    [submenuId, commands],
  );

  const filtered = useMemo(() => {
    if (query.trim()) return searchCommands(commands, query);
    if (submenuParent?.children) return submenuParent.children;
    return commands;
  }, [query, commands, submenuParent]);

  const grouped = useMemo(() => groupCommands(filtered), [filtered]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        if (isOpen) close();
        else open();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        // Chrome's own "save page" would fire otherwise, and it saves the wrong thing entirely.
        e.preventDefault();
        if (isOpen) close();
        // The quick write only exists once there is a file to write; without one — or with Shift,
        // to reach the format and destination controls — this is the dialog's job.
        if (e.shiftKey) setDialog({ id: 'save' });
        else void saveLinkedFile(modeler).then((saved) => { if (!saved) setDialog({ id: 'save' }); });
        return;
      }
      // `/` opens, never closes; in the palette it is just a character to search with.
      if (isBareKey(e, '/') && !isOpen && !isTyping(e.target)) {
        e.preventDefault();
        open();
        return;
      }
      // `p` on a selected element opens its provenance, the way the inspector follows the selection.
      if (isBareKey(e, 'p') && !isOpen && !dialog && !isTyping(e.target)) {
        const selected = modeler ? modeler.selection.get() : [];
        const scopeId = selected.length === 1 ? selected[0]?.businessObject?.id : undefined;
        if (!scopeId) return;
        e.preventDefault();
        setDialog({ id: 'provenance', scopeId });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modeler, isOpen, dialog, linkedFileName]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const runCommand = (c: PaletteCommand) => {
    if (c.children) {
      setSubmenuId(c.id);
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    close();
    c.action?.();
  };

  const popSubmenu = () => {
    setSubmenuId(null);
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // `stopPropagation` keeps Escape from reaching the Dialog, which would close the whole palette.
    if (submenuId && query === '' && (e.key === 'Backspace' || e.key === 'Escape')) {
      e.preventDefault();
      e.stopPropagation();
      popSubmenu();
      return;
    }
    if (query === '' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const shortcutSource = submenuParent?.children ?? commands;
      const match = shortcutSource.find((c) => c.shortcut && isBareKey(e, c.shortcut));
      if (match) {
        e.preventDefault();
        runCommand(match);
        return;
      }
    }
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(filtered[activeIndex]);
    }
  };

  return (
    <>
      {/* Only the open dialog is mounted: mounting all seven runs every dialog's hooks on boot. */}
      {dialog && createElement(SUB_DIALOGS[dialog.id], {
        isOpen: true,
        onClose: () => setDialog(null),
        scopeId: dialog.scopeId,
        // The hidden `<input>` below stays mounted for the fallback, so the palette owns the pick.
        onBrowse: diagramPicker.open,
      })}
      <input {...diagramPicker.inputProps} />
      <Dialog open={isOpen} onClose={close} className={cp.root}>
        <div className={cp.backdrop} aria-hidden="true" />
        <div className={cp.layout}>
          <DialogPanel transition className={cp.panel}>
            <div className={cp.searchRow}>
              <i className={cp.searchIcon}></i>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={submenuParent
                  ? `Search ${submenuParent.label.replace(/\.\.\.$/, '').toLowerCase()}...`
                  : `Search commands... (${OPEN_PALETTE_SHORTCUT_LABEL} or "/" to toggle)`}
                className={cp.searchInput}
                aria-label="Search commands"
              />
            </div>
            {submenuParent && (
              <div className={cp.breadcrumbRow}>
                <button
                  type="button"
                  onClick={popSubmenu}
                  className={cp.breadcrumbBack}
                  title="Back to main palette (Esc or Backspace)"
                >
                  <i className={ICONS.arrowLeft}></i>
                  <span>Back</span>
                </button>
                <span className={cp.breadcrumbDivider}>/</span>
                <span className={cp.breadcrumbLabel}>
                  {submenuParent.label.replace(/\.\.\.$/, '')}
                </span>
              </div>
            )}
            <div ref={listRef} className={cp.list}>
              {filtered.length === 0 ? (
                <div className={cp.empty}>No matching commands.</div>
              ) : (
                grouped.map(([group, items]) => (
                  <div key={group}>
                    <div className={cp.groupLabel}>{group}</div>
                    {items.map((c) => {
                      const flatIndex = filtered.indexOf(c);
                      const active = flatIndex === activeIndex;
                      const isParent = !!c.children;
                      const hint = c.shortcut?.toUpperCase() ?? (isParent ? undefined : c.hint);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          data-cmd-index={flatIndex}
                          className={`${cp.item} ${active ? cp.itemActive : ''}`}
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => runCommand(c)}
                        >
                          <i className={`${c.icon} ${cp.itemIcon}`}></i>
                          <span className={cp.itemLabel}>{c.label}</span>
                          {hint && <span className={cp.itemHint}>{hint}</span>}
                          {isParent && (
                            <i className={cp.itemChevron} aria-hidden="true"></i>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
