import { Dialog, DialogPanel } from '@headlessui/react';
import {
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { SettingsViewContext } from '@/modeler/infra/contexts';
import { useModeler } from '@/modeler/views/useModeler';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useIsSimulating } from '@/modeler/views/simulation/useIsSimulating';
import { commandPalette as cp } from '@/modeler/infra/styles';
import { VALID_FILE_EXTENSIONS } from '@/modeler/infra/constants';
import { ExamplesDialog } from '@/modeler/views/dialogs/Examples';
import { TemplateGalleryDialog } from '@/modeler/views/dialogs/TemplateGallery';
import { PublishDialog } from '@/modeler/views/dialogs/Publish';
import { ChecklistDialog } from '@/modeler/views/dialogs/Checklist';
import { GanttDialog } from '@/modeler/views/dialogs/Gantt';
import { buildPaletteCommands } from '@/modeler/controllers/commandPalette/commands';
import {
  findCommand,
  groupCommands,
  searchCommands,
  type PaletteCommand,
  type PaletteDialogId,
} from '@/modeler/models/commandPalette/types';
import { useFilePicker } from '@/modeler/views/dialogs/commandPalette/useFilePicker';
import { ICONS } from '@/icons';

/** Modal dialogs the palette can hand off to, keyed by `PaletteDialogId`. */
const SUB_DIALOGS: Record<PaletteDialogId, ComponentType<{ isOpen: boolean; onClose: () => void }>> = {
  examples: ExamplesDialog,
  templates: TemplateGalleryDialog,
  publish: PublishDialog,
  checklist: ChecklistDialog,
  gantt: GanttDialog,
};

function isBareKey(e: ReactKeyboardEvent, key: string): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPad|iPhone|iPod/.test(navigator.platform);

/** Cross-platform label for the palette's global open shortcut. */
export const OPEN_PALETTE_SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

type Props = {
  ref?: React.Ref<{ open: () => void; close: () => void }>;
};

export function CommandPalette({ ref }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const [dialogId, setDialogId] = useState<PaletteDialogId | null>(null);
  const modeler = useModeler();
  const { openSettings } = useContext(SettingsViewContext);
  const isSimulating = useIsSimulating(modeler);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const diagramPicker = useFilePicker({
    accept: VALID_FILE_EXTENSIONS.join(','),
    testId: 'open-file-input',
    isValid: (name) => VALID_FILE_EXTENSIONS.some((ext) => name.endsWith(ext)),
    invalidMessage: 'Please select a valid XML, SVG, or Studyflow file.',
    failureMessage: 'Failed to open diagram.',
    onText: (filename, content) =>
      executeCommand(modeler, { type: 'open-diagram', filename, content }),
  });

  const jsPsychPicker = useFilePicker({
    accept: '.json',
    testId: 'import-jspsych-input',
    isValid: (name) => name.endsWith('.json'),
    invalidMessage: 'Please select a jsPsych timeline JSON file.',
    failureMessage: 'Failed to import the jsPsych timeline.',
    onText: (filename, content) =>
      executeCommand(modeler, { type: 'import-jspsych', filename, content }),
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
        openDialog: setDialogId,
        pickDiagramFile: diagramPicker.open,
        pickJsPsychFile: jsPsychPicker.open,
      }),
    [modeler, openSettings, isSimulating],
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
    setActiveIndex(0);
  }, [query]);

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

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
    // ESC inside a submenu pops one level rather than closing the palette entirely.
    // Backspace at the start of an empty query also pops.
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
      {(Object.entries(SUB_DIALOGS) as Array<[PaletteDialogId, ComponentType<{ isOpen: boolean; onClose: () => void }>]>).map(
        ([id, SubDialog]) => (
          <SubDialog key={id} isOpen={dialogId === id} onClose={() => setDialogId(null)} />
        ),
      )}
      <input {...diagramPicker.inputProps} />
      <input {...jsPsychPicker.inputProps} />
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
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={submenuParent
                  ? `Search ${submenuParent.label.replace(/\.\.\.$/, '').toLowerCase()}...`
                  : `Search commands... (${OPEN_PALETTE_SHORTCUT_LABEL} to toggle)`}
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
