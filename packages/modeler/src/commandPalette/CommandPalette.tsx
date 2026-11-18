import { Dialog, DialogPanel } from '@headlessui/react';
import {
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useSyncExternalStore,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ModeContext, SettingsViewContext } from '@modeler/app/contexts';
import { useDialogs } from '@modeler/app/Dialogs';
import { useModeler } from '@modeler/app/useModeler';
import type { Editor } from '@modeler/editor/port';
import { useIsSimulating, useIsSimulationPaused } from '@modeler/simulation/useIsSimulating';
import { MOD_LABEL } from '@modeler/constants';
import { getLinkedFileName, subscribeLink } from '@modeler/diagram/fileHandle';
import { saveLinkedFile } from '@modeler/diagram/save';
import { commandPalette as cp } from '@modeler/commandPalette/styles';
import { buildElementEntries, buildPaletteCommands } from '@modeler/commandPalette/menu';
import { selectionCommands } from '@modeler/contextPad/actions';
import { groupCommands, searchCommands, type PaletteCommand } from '@modeler/commandPalette/types';
import { openView } from '@modeler/views/store';

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

/** A field commits its text when it loses the focus. A save by key therefore blurs the field and focuses it again,
 * or the saved file would lack that text. The blur also closes a name editor on the canvas, which leaves the focus
 * on the canvas. */
function commitTyping(modeler: Editor): void {
  const field = document.activeElement as HTMLElement | null;
  if (!field || !isTyping(field)) return;
  field.blur();
  if (field.isConnected) field.focus();
  else modeler.canvas.focus();
}

export const OPEN_PALETTE_SHORTCUT_LABEL = `${MOD_LABEL}K`;

/** What the chrome may ask of the palette: open it, out of the composer, or close it. */
export type CommandPaletteHandle = { open: () => void; close: () => void };

type Props = {
  ref?: React.Ref<CommandPaletteHandle>;
};

export function CommandPalette({ ref }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const modeler = useModeler();
  const { openSettings } = useContext(SettingsViewContext);
  const { mode } = useContext(ModeContext);
  const { dialog, openDialog } = useDialogs();
  const isSimulating = useIsSimulating(modeler);
  const isPaused = useIsSimulationPaused(modeler);
  // A string selector, so the palette does not re-render through every save state transition.
  const linkedFileName = useSyncExternalStore(subscribeLink, getLinkedFileName, getLinkedFileName);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // It opens out of the composer, from its prompt or by ⌘K.
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
        isPaused,
        openSettings,
        // Palette-opened dialogs are unscoped; only the `p`-on-selection path sets a provenance scope.
        openDialog: (id) => openDialog(id),
        linkedFileName,
      }),
    [modeler, openSettings, isSimulating, isPaused, openDialog, linkedFileName],
  );

  // The study's elements, read as the palette opens; they join the list once something is typed.
  const elements = useMemo(() => (isOpen && modeler ? buildElementEntries(modeler) : []), [isOpen, modeler]);
  // The selection's commands, the context pad's, first: the palette opened with something selected is about it. Only
  // while editing: a replay and a review leave the document read-only.
  const selection = useMemo(
    () => (isOpen && modeler && mode !== 'replay' && mode !== 'review' ? selectionCommands(modeler) : []),
    [isOpen, modeler, mode],
  );

  // Unsearched, it lists what is at hand (the selection's, the study's); the app menu's own and the study's elements
  // join once something is typed.
  const filtered = useMemo(() => {
    const searching = query.trim() !== '';
    return [
      ...searchCommands(selection, query),
      ...searchCommands(searching ? commands : commands.filter((command) => !command.searchOnly), query),
      ...(searching ? searchCommands(elements, query) : []),
    ];
  }, [query, selection, commands, elements]);

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
        // Otherwise Chrome's own "save page" dialog opens, which saves the page, not the study.
        e.preventDefault();
        commitTyping(modeler);
        if (isOpen) close();
        // The quick write needs a linked file. Without one, or with Shift (to reach the format and destination
        // controls), the Save dialog opens instead.
        if (e.shiftKey) openDialog('save');
        else void saveLinkedFile(modeler).then((saved) => { if (!saved) openDialog('save'); });
        return;
      }
      // `p` on a selected element opens its provenance alone, in the views' drawer.
      if (isBareKey(e, 'p') && !isOpen && !dialog && !isTyping(e.target)) {
        const selected = modeler.canvas.selection;
        // A caption stands for what it captions.
        const record = selected.length === 1 ? modeler.study.get(selected[0]) : undefined;
        const scopeId = record?.kind === 'label' ? record.owner : record?.id;
        if (!scopeId) return;
        e.preventDefault();
        openView('provenance', scopeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modeler, isOpen, dialog, openDialog, linkedFileName]);

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
    const st = cp.row;
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
              placeholder="Search commands and elements..."
              className={cp.searchInput}
              aria-label="Search commands"
            />
          </div>
          <div ref={listRef} className={cp.list}>
            {filtered.length === 0 ? (
              <div className={cp.empty}>No matching commands.</div>
            ) : (
              grouped.map(([group, items]) => (
                <div key={group}>
                  <div className={cp.groupLabel}>{group}</div>
                  {items.map(renderItem)}
                </div>
              ))
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
