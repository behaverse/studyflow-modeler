import { Dialog, DialogPanel } from '@headlessui/react';
import {
  createElement,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { SettingsViewContext } from '@modeler/app/contexts';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { commandPalette as cp } from '@modeler/commandPalette/styles';
import { IMPORTABLE_EXTENSIONS } from '@modeler/export/formats';
import { ExamplesDialog } from '@modeler/examples/Examples';
import { TemplateGalleryDialog } from '@modeler/templates/TemplateGallery';
import { ExportDialog } from '@modeler/export/Export';
import { PublishDialog } from '@modeler/publish/Publish';
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

const SUB_DIALOGS: Record<PaletteDialogId, ComponentType<{ isOpen: boolean; onClose: () => void; scopeId?: string }>> = {
  examples: ExamplesDialog,
  templates: TemplateGalleryDialog,
  export: ExportDialog,
  publish: PublishDialog,
  checklist: ChecklistDialog,
  gantt: GanttDialog,
  provenance: ProvenanceDialog,
};

function isBareKey(e: ReactKeyboardEvent, key: string): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPad|iPhone|iPod/.test(navigator.platform);

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
  const [provenanceScopeId, setProvenanceScopeId] = useState<string | null>(null);
  const modeler = useRequiredModeler();
  const { openSettings } = useContext(SettingsViewContext);
  const isSimulating = useIsSimulating(modeler);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const diagramPicker = useFilePicker({
    accept: IMPORTABLE_EXTENSIONS.join(','),
    testId: 'open-file-input',
    isValid: (name) => IMPORTABLE_EXTENSIONS.some((ext) => name.endsWith(ext)),
    invalidMessage: 'Please select a valid XML, SVG, PNG, or Studyflow file.',
    isBinary: (name) => name.endsWith('.png'),
    failureMessage: 'Failed to open diagram.',
    onText: (filename, content) => {
      if (content == null) throw new Error('Could not read the file.');
      return executeCommand(modeler, { type: 'OpenDiagram', filename, content });
    },
  });

  const jsPsychPicker = useFilePicker({
    accept: '.json',
    testId: 'import-jspsych-input',
    isValid: (name) => name.endsWith('.json'),
    invalidMessage: 'Please select a jsPsych timeline JSON file.',
    failureMessage: 'Failed to import the jsPsych timeline.',
    onText: (filename, content) => {
      if (typeof content !== 'string') throw new Error('Could not read the timeline as text.');
      return executeCommand(modeler, { type: 'ImportJsPsych', filename, content });
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
        openDialog: (id: PaletteDialogId) => {
          setProvenanceScopeId(null);
          setDialogId(id);
        },
        pickDiagramFile: diagramPicker.open,
        pickJsPsychFile: jsPsychPicker.open,
      }),
    [modeler, openSettings, isSimulating, diagramPicker.open, jsPsychPicker.open],
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
      // `/` opens (never closes — in the palette it is just a character to search with).
      const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (isSlash && !isOpen && !isTyping(e.target)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // `p` on a selected element opens its provenance, the way the inspector follows the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTyping(e.target) || isOpen || dialogId) return;
      const selected = modeler?.get?.('selection', false)?.get?.() ?? [];
      const scopeId = selected.length === 1 ? selected[0]?.businessObject?.id : undefined;
      if (!scopeId) return;
      e.preventDefault();
      setProvenanceScopeId(scopeId);
      setDialogId('provenance');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modeler, isOpen, dialogId]);

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
      {dialogId && createElement(SUB_DIALOGS[dialogId], {
        isOpen: true,
        onClose: () => {
          setDialogId(null);
          setProvenanceScopeId(null);
        },
        ...(dialogId === 'provenance' && provenanceScopeId ? { scopeId: provenanceScopeId } : {}),
      })}
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
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
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
