import { Dialog, DialogPanel } from '@headlessui/react';
import {
  useContext,
  useImperativeHandle,
  useState,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { SettingsViewContext } from '../contexts';
import { useModeler } from '../useModeler';
import { executeCommand } from '../commands';
import { useIsSimulating } from '../simulation/useIsSimulating';
import { ExamplesDialog } from './Examples';
import { TemplateGalleryDialog } from './TemplateGallery';
import { PublishDialog } from './Publish';
import { ChecklistDialog } from './Checklist';
import { GanttDialog } from './Gantt';
import { commandPalette as cp } from '../styles';
import { URLS, VALID_FILE_EXTENSIONS } from '../constants';

type Command = {
  id: string;
  group: string;
  label: string;
  icon: string;
  hint?: string;
  /** Single-key shortcut active only when the search box is empty. */
  shortcut?: string;
  /** Leaf action. Required unless `children` is set. */
  action?: () => void | Promise<void>;
  /** When present, clicking this command opens a sub-palette instead of running. */
  children?: Command[];
};

function flattenAll(cmds: Command[]): Command[] {
  const out: Command[] = [];
  for (const c of cmds) {
    out.push(c);
    if (c.children) out.push(...flattenAll(c.children));
  }
  return out;
}

function findCommand(cmds: Command[], id: string): Command | null {
  for (const c of cmds) {
    if (c.id === id) return c;
    if (c.children) {
      const hit = findCommand(c.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function isBareKey(e: React.KeyboardEvent, key: string): boolean {
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
  const [isExamplesOpen, setIsExamplesOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);
  const [isGanttOpen, setIsGanttOpen] = useState(false);
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const modeler = useModeler();
  const { openSettings } = useContext(SettingsViewContext);
  const isSimulating = useIsSimulating(modeler);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsPsychInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const open = () => {
    setQuery('');
    setActiveIndex(0);
    setSubmenuId(null);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useImperativeHandle(ref, () => ({ open, close }), []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = VALID_FILE_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!ok) {
      alert('Please select a valid XML, SVG, or Studyflow file.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = (loadEvent) => {
      const content = (loadEvent.target as FileReader).result;
      executeCommand(modeler, {
        type: 'open-diagram',
        filename: file.name,
        content,
      }).catch((err: any) => {
        alert(err?.message || 'Failed to open diagram.');
        console.error(err);
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleJsPsychFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      alert('Please select a jsPsych timeline JSON file.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = (loadEvent) => {
      const content = (loadEvent.target as FileReader).result;
      executeCommand(modeler, {
        type: 'import-jspsych',
        filename: file.name,
        content,
      }).catch((err: any) => {
        alert(err?.message || 'Failed to import the jsPsych timeline.');
        console.error(err);
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const commands: Command[] = useMemo(
    () => [
      {
        id: 'simulate',
        group: 'Run',
        label: isSimulating ? 'Stop Simulation' : 'Start Simulation',
        icon: isSimulating ? 'iconify bi--stop' : 'iconify bi--play',
        action: () => executeCommand(modeler, { type: 'toggle-simulation' }),
      },
      {
        id: 'run',
        group: 'Run',
        label: 'Run',
        icon: 'iconify bi--play-fill',
        shortcut: '1',
        action: () => executeCommand(modeler, { type: 'open-runner' }),
      },
      {
        id: 'new',
        group: 'File',
        label: 'New',
        icon: 'iconify bi--file-earmark-plus',
        shortcut: '2',
        action: () => {
          alert('Warning: this will delete the current diagram and load an empty one. It cannot be undone.');
          if (modeler) executeCommand(modeler, { type: 'new-diagram' }).catch(console.error);
        },
      },
      {
        id: 'new-from-template',
        group: 'File',
        label: 'New from Template...',
        icon: 'iconify bi--grid-1x2',
        action: () => setIsTemplatesOpen(true),
      },
      {
        id: 'open',
        group: 'File',
        label: 'Open File...',
        icon: 'iconify bi--folder2-open',
        shortcut: '3',
        action: () => fileInputRef.current?.click(),
      },
      {
        id: 'import',
        group: 'File',
        label: 'Import...',
        icon: 'iconify bi--box-arrow-in-down',
        hint: 'submenu',
        children: [
          {
            id: 'import-jspsych',
            group: 'Import',
            label: 'jsPsych Timeline...',
            icon: 'iconify bi--filetype-json',
            hint: '.json',
            action: () => jsPsychInputRef.current?.click(),
          },
        ],
      },
      {
        id: 'examples',
        group: 'File',
        label: 'Examples...',
        icon: 'iconify bi--collection',
        shortcut: '4',
        action: () => setIsExamplesOpen(true),
      },
      {
        id: 'save-as',
        group: 'File',
        label: 'Save As...',
        icon: 'iconify bi--download',
        shortcut: '5',
        hint: 'submenu',
        children: [
          {
            id: 'save-studyflow',
            group: 'Save As',
            label: 'Studyflow...',
            icon: 'iconify bi--filetype-yml',
            hint: '.studyflow',
            action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'studyflow' }),
          },
          {
            id: 'save-bpmn',
            group: 'Save As',
            label: 'BPMN 2.0 XML...',
            icon: 'iconify bi--filetype-xml',
            hint: '.bpmn',
            action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'bpmn' }),
          },
          {
            id: 'save-svg',
            group: 'Save As',
            label: 'SVG...',
            icon: 'iconify bi--filetype-svg',
            hint: '.svg',
            action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'svg' }),
          },
          {
            id: 'save-png',
            group: 'Save As',
            label: 'PNG...',
            icon: 'iconify bi--filetype-png',
            hint: '.png',
            action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'png' }),
          },
          {
            id: 'save-linkml',
            group: 'Save As',
            label: 'Schema (data elements)...',
            icon: 'iconify bi--filetype-yml',
            hint: '.linkml.yaml',
            action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'linkml' }),
          },
          {
            id: 'save-nidm',
            group: 'Save As',
            label: 'NIDM-Results (analysis)...',
            icon: 'iconify bi--diagram-3',
            hint: '.nidm.ttl',
            action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'nidm' }),
          },
          {
            id: 'save-artemis',
            group: 'Save As',
            label: 'ARTEM-IS (EEG methods)...',
            icon: 'iconify bi--filetype-json',
            hint: '.artemis.json',
            action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'artemis' }),
          },
        ],
      },
      {
        id: 'publish',
        group: 'File',
        label: 'Publish...',
        icon: 'iconify bi--broadcast-pin',
        action: () => setIsPublishOpen(true),
      },
      {
        id: 'reset-zoom',
        group: 'View',
        label: 'Reset Zoom',
        icon: 'iconify bi--fullscreen',
        shortcut: '0',
        action: () => executeCommand(modeler, { type: 'reset-zoom' })
          .catch((err) => console.warn('Zoom to fit failed', err)),
      },
      {
        id: 'view-as',
        group: 'View',
        label: 'View As...',
        icon: 'iconify bi--eye',
        hint: 'submenu',
        children: [
          {
            id: 'checklist-view',
            group: 'View As',
            label: 'Checklist',
            icon: 'iconify bi--check2-square',
            action: () => setIsChecklistOpen(true),
          },
          {
            id: 'gantt-view',
            group: 'View As',
            label: 'Gantt',
            icon: 'iconify bi--bar-chart-steps',
            action: () => setIsGanttOpen(true),
          },
        ],
      },
      {
        id: 'settings',
        group: 'Settings',
        label: 'Settings...',
        icon: 'iconify bi--gear',
        shortcut: '6',
        action: openSettings,
      },
      {
        id: 'docs',
        group: 'Help',
        label: 'Docs',
        icon: 'iconify bi--book',
        action: () => window.open(URLS.docs, '_blank'),
      },
      {
        id: 'github',
        group: 'Help',
        label: 'GitHub',
        icon: 'iconify bi--github',
        action: () => window.open(URLS.githubRepo, '_blank'),
      },
    ],
    [modeler, openSettings, isSimulating],
  );

  const submenuParent = useMemo(
    () => (submenuId ? findCommand(commands, submenuId) : null),
    [submenuId, commands],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      // When searching, flatten and search every leaf command across all submenus.
      return flattenAll(commands).filter(
        (c) => !c.children && (c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)),
      );
    }
    if (submenuParent?.children) return submenuParent.children;
    return commands;
  }, [query, commands, submenuParent]);

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return Array.from(map);
  }, [filtered]);

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

  const runCommand = (c: Command) => {
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
      <ExamplesDialog isOpen={isExamplesOpen} onClose={() => setIsExamplesOpen(false)} />
      <TemplateGalleryDialog isOpen={isTemplatesOpen} onClose={() => setIsTemplatesOpen(false)} />
      <PublishDialog isOpen={isPublishOpen} onClose={() => setIsPublishOpen(false)} />
      <ChecklistDialog isOpen={isChecklistOpen} onClose={() => setIsChecklistOpen(false)} />
      <GanttDialog isOpen={isGanttOpen} onClose={() => setIsGanttOpen(false)} />
      <input
        ref={fileInputRef}
        type="file"
        accept={VALID_FILE_EXTENSIONS.join(',')}
        data-testid="open-file-input"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={jsPsychInputRef}
        type="file"
        accept=".json"
        data-testid="import-jspsych-input"
        className="hidden"
        onChange={handleJsPsychFileChange}
      />
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
              <div className="px-3 py-1.5 text-[11px] text-stone-500 flex items-center gap-2 border-b border-black/[0.04]">
                <button
                  type="button"
                  onClick={popSubmenu}
                  className="hover:text-stone-900 inline-flex items-center gap-1"
                  title="Back to main palette (Esc or Backspace)"
                >
                  <i className="iconify bi--arrow-left"></i>
                  <span>Back</span>
                </button>
                <span className="text-stone-300">/</span>
                <span className="text-stone-700 font-medium">
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
                            <i className="iconify bi--chevron-right text-stone-400 text-[10px] ml-1" aria-hidden="true"></i>
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
