import { Dialog, DialogPanel } from '@headlessui/react';
import {
  useImperativeHandle,
  useState,
  useEffect,
  useMemo,
  useRef,
  useContext,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ModelerContext, DiagramNameContext, SimulationContext } from '../contexts';
import { executeCommand } from '../commands';
import { ExamplesDialog } from './Examples';
import { PublishDialog } from './Publish';
import { commandPalette as cp } from '../styles';
import { URLS, VALID_FILE_EXTENSIONS } from '../constants';

type Command = {
  id: string;
  group: string;
  label: string;
  icon: string;
  hint?: string;
  action: () => void | Promise<void>;
};

type Props = {
  ref?: React.Ref<{ open: () => void; close: () => void }>;
  openSettings?: () => void;
};

export function CommandPalette({ ref, openSettings }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const { modeler } = useContext(ModelerContext);
  const { diagramName, setDiagramName } = useContext(DiagramNameContext);
  const { isSimulating, setIsSimulating } = useContext(SimulationContext);

  const examplesDialogRef = useRef<{ open: () => void }>(null);
  const publishDialogRef = useRef<{ open: () => void }>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const open = () => {
    setQuery('');
    setActiveIndex(0);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useImperativeHandle(ref, () => ({ open, close }), []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ok = VALID_FILE_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!ok) {
      alert('Please select a valid XML, SVG, or Studyflow file.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = (e) => {
      const content = (e.target as FileReader).result;
      executeCommand(modeler, {
        type: 'open-diagram',
        filename: file.name,
        content,
        setDiagramName,
      }).catch((err: any) => {
        alert(err?.message || 'Failed to open diagram.');
        console.error(err);
      });
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const commands: Command[] = useMemo(
    () => [
      {
        id: 'simulate',
        group: 'Run',
        label: isSimulating ? 'Stop Simulation' : 'Start Simulation',
        icon: isSimulating ? 'iconify bi--stop-circle' : 'iconify bi--play-circle',
        action: () => {
          executeCommand(modeler, { type: 'toggle-simulation', currentActive: isSimulating });
          setIsSimulating(!isSimulating);
        },
      },
      {
        id: 'run',
        group: 'Run',
        label: 'Run in New Tab',
        icon: 'iconify bi--box-arrow-up-right',
        action: async () => {
          if (!modeler) return;
          const { xml } = await modeler.saveXML({ format: true });
          const sessionId = `studyflow-${crypto.randomUUID()}`;
          localStorage.setItem(sessionId, xml);
          const params = new URLSearchParams({ session_id: sessionId, seed: '42' });
          window.open(`./run.html?${params.toString()}`, '_blank', 'noopener');
        },
      },
      {
        id: 'new',
        group: 'File',
        label: 'New',
        icon: 'iconify bi--file-earmark-plus',
        action: () => {
          alert('FIXME: this will delete the current diagram and load an empty one. It cannot be undone.');
          if (modeler) executeCommand(modeler, { type: 'new-diagram' }).catch((err) => console.log(err));
        },
      },
      {
        id: 'open',
        group: 'File',
        label: 'Open File...',
        icon: 'iconify bi--folder2-open',
        action: () => fileInputRef.current?.click(),
      },
      {
        id: 'examples',
        group: 'File',
        label: 'Examples...',
        icon: 'iconify bi--collection',
        action: () => examplesDialogRef.current?.open(),
      },
      {
        id: 'save',
        group: 'File',
        label: 'Save As...',
        icon: 'iconify bi--download',
        action: () => executeCommand(modeler, { type: 'save-diagram', diagramName }),
      },
      {
        id: 'export-svg',
        group: 'File',
        label: 'Export to SVG...',
        icon: 'iconify bi--filetype-svg',
        action: () =>
          executeCommand(modeler, { type: 'export-diagram', diagramName, fileType: 'svg' }),
      },
      {
        id: 'export-png',
        group: 'File',
        label: 'Export to PNG...',
        icon: 'iconify bi--filetype-png',
        action: () =>
          executeCommand(modeler, { type: 'export-diagram', diagramName, fileType: 'png' }),
      },
      {
        id: 'publish',
        group: 'File',
        label: 'Publish...',
        icon: 'iconify bi--broadcast-pin',
        action: () => publishDialogRef.current?.open(),
      },
      {
        id: 'reset-zoom',
        group: 'View',
        label: 'Reset Zoom',
        icon: 'iconify bi--fullscreen',
        action: () => {
          try {
            executeCommand(modeler, { type: 'reset-zoom' });
          } catch (err) {
            console.warn('Zoom to fit failed', err);
          }
        },
      },
      {
        id: 'settings',
        group: 'Settings',
        label: 'Settings...',
        icon: 'iconify bi--gear',
        action: () => openSettings?.(),
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
    [modeler, diagramName, setDiagramName, openSettings, isSimulating, setIsSimulating],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [query, commands]);

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return Array.from(map.entries());
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
    close();
    c.action();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
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
      <ExamplesDialog ref={examplesDialogRef} />
      <PublishDialog ref={publishDialogRef} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.bpmn,.studyflow,.svg"
        className="hidden"
        onChange={handleFileChange}
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
                placeholder="Search commands..."
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
                    {items.map((c) => {
                      const idx = filtered.indexOf(c);
                      const active = idx === activeIndex;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          data-cmd-index={idx}
                          className={`${cp.item} ${active ? cp.itemActive : ''}`}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => runCommand(c)}
                        >
                          <i className={`${c.icon} ${cp.itemIcon}`}></i>
                          <span className={cp.itemLabel}>{c.label}</span>
                          {c.hint && <span className={cp.itemHint}>{c.hint}</span>}
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
