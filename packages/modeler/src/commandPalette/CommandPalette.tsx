import { Dialog, DialogPanel } from '@headlessui/react';
import {
  createElement,
  useCallback,
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
import { useModeler } from '@modeler/app/useModeler';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { MOD_LABEL, URLS } from '@modeler/constants';
import { getLinkedFileName, subscribeLink } from '@modeler/diagram/fileHandle';
import { saveLinkedFile } from '@modeler/diagram/save';
import { commandPalette as cp } from '@modeler/commandPalette/styles';
import { useDiagramPicker } from '@modeler/open/openFile';
import { GalleryDialog } from '@modeler/gallery/Gallery';
import { OpenDialog } from '@modeler/open/Open';
import { SaveDialog } from '@modeler/export/Save';
import { ChecklistDialog } from '@modeler/checklist/Checklist';
import { GanttDialog } from '@modeler/gantt/Gantt';
import { ProvenanceDialog } from '@modeler/provenance/Provenance';
import { buildPaletteCommands } from '@modeler/commandPalette/menu';
import {
  groupCommands,
  searchCommands,
  type PaletteCommand,
  type PaletteDialogId,
} from '@modeler/commandPalette/types';
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
  const [dialog, setDialog] = useState<{ id: PaletteDialogId; scopeId?: string } | null>(null);
  const modeler = useModeler();
  const { openSettings } = useContext(SettingsViewContext);
  const { openReplay } = useContext(ReplayContext);
  const isSimulating = useIsSimulating(modeler);
  // A string selector, so the palette does not re-render through every save state transition.
  const linkedFileName = useSyncExternalStore(subscribeLink, getLinkedFileName, getLinkedFileName);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The pick may have been started from the Open dialog, which has nothing left to say once a file opens.
  const closeDialog = useCallback(() => setDialog(null), []);
  const diagramPicker = useDiagramPicker(modeler, closeDialog);

  const open = () => {
    setQuery('');
    setActiveIndex(0);
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

  const filtered = useMemo(() => searchCommands(commands, query), [query, commands]);

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
        const selected = modeler.selection.get();
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
    close();
    c.action();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (query === '' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const match = commands.find((c) => c.shortcut && isBareKey(e, c.shortcut));
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

  const renderItem = (c: PaletteCommand) => {
    const st = c.tile ? cp.tile : cp.row;
    const flatIndex = filtered.indexOf(c);
    const active = flatIndex === activeIndex;
    const hint = c.shortcut?.toUpperCase() ?? c.hint;
    return (
      <button
        key={c.id}
        type="button"
        data-cmd-index={flatIndex}
        className={`${st.item} ${active ? cp.itemActive : ''}`}
        onMouseEnter={() => setActiveIndex(flatIndex)}
        onClick={() => runCommand(c)}
      >
        <i className={`${c.icon} ${st.icon}`}></i>
        <span className={st.label}>{c.label}</span>
        {hint && <span className={`${cp.itemHint} ${st.hint}`}>{hint}</span>}
      </button>
    );
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
                placeholder={`Search commands... (${OPEN_PALETTE_SHORTCUT_LABEL} or "/" to toggle)`}
                className={cp.searchInput}
                aria-label="Search commands"
              />
              {/* A link, not a command: it never gets searched, selected, or numbered. */}
              <a
                href={URLS.githubRepo}
                target="_blank"
                rel="noreferrer"
                title="GitHub"
                aria-label="Open GitHub repository"
                className={cp.githubLink}
              >
                <i className={ICONS.github}></i>
              </a>
            </div>
            <div ref={listRef} className={cp.list}>
              {filtered.length === 0 ? (
                <div className={cp.empty}>No matching commands.</div>
              ) : (
                grouped.map(([group, items]) => {
                  const tiles = items.filter((c) => c.tile);
                  const rows = items.filter((c) => !c.tile);
                  return (
                    <div key={group}>
                      {tiles.length === 0 && <div className={cp.groupLabel}>{group}</div>}
                      {tiles.length > 0 && <div className={cp.tile.wrap}>{tiles.map(renderItem)}</div>}
                      {rows.map(renderItem)}
                    </div>
                  );
                })
              )}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
