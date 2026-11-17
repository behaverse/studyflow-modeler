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
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { MOD_LABEL, URLS } from '@modeler/constants';
import { getLinkedFileName, subscribeLink } from '@modeler/diagram/fileHandle';
import { saveLinkedFile } from '@modeler/diagram/save';
import { commandPalette as cp } from '@modeler/commandPalette/styles';
import { buildElementEntries, buildPaletteCommands } from '@modeler/commandPalette/menu';
import { groupCommands, searchCommands, type PaletteCommand } from '@modeler/commandPalette/types';
import { ICONS } from '@modeler/icons';

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

/** What the app menu may ask of the palette: open or close it. */
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
  const { openReplay } = useContext(ModeContext);
  const { dialog, openDialog } = useDialogs();
  const isSimulating = useIsSimulating(modeler);
  // A string selector, so the palette does not re-render through every save state transition.
  const linkedFileName = useSyncExternalStore(subscribeLink, getLinkedFileName, getLinkedFileName);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
        openDialog: (id) => openDialog(id),
        openReplay,
        linkedFileName,
      }),
    [modeler, openSettings, isSimulating, openDialog, openReplay, linkedFileName],
  );

  // The study's elements, read as the palette opens; they join the list once something is typed.
  const elements = useMemo(() => (isOpen && modeler ? buildElementEntries(modeler) : []), [isOpen, modeler]);

  const filtered = useMemo(
    () => [...searchCommands(commands, query), ...(query.trim() ? searchCommands(elements, query) : [])],
    [query, commands, elements],
  );

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
      // `/` opens, never closes; in the palette it is just a character to search with.
      if (isBareKey(e, '/') && !isOpen && !isTyping(e.target)) {
        e.preventDefault();
        open();
        return;
      }
      // `p` on a selected element opens its provenance, the way the inspector follows the selection.
      if (isBareKey(e, 'p') && !isOpen && !dialog && !isTyping(e.target)) {
        const selected = modeler.canvas.selection;
        // A caption stands for what it captions.
        const record = selected.length === 1 ? modeler.study.get(selected[0]) : undefined;
        const scopeId = record?.kind === 'label' ? record.owner : record?.id;
        if (!scopeId) return;
        e.preventDefault();
        openDialog('provenance', scopeId);
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
  );
}
