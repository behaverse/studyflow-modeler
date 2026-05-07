import { useContext, useEffect, useImperativeHandle, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { DiagramNameContext, ModelerContext } from '../contexts';
import { executeCommand } from '../commands';
import { dialog as d, examplesList as e } from '../styles';
import { NAMESPACES } from '../constants';

const exampleFiles = import.meta.glob(
  '@/assets/examples/*.{studyflow,bpmn,svg}',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

type ExampleEntry = {
  filename: string;
  url: string;
  title: string;
  description: string;
  content?: string;
  error?: string;
};

function humanizeId(id: string): string {
  return id.replace(/[_-]+/g, ' ').trim();
}

function parseExampleMetadata(filename: string, xml: string): { title: string; description: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid XML');
  }

  const process = doc.getElementsByTagNameNS(NAMESPACES.bpmn, 'process')[0]
    ?? doc.getElementsByTagNameNS(NAMESPACES.studyflow, 'study')[0];

  let title = '';
  if (process) {
    title = process.getAttribute('name')?.trim() || humanizeId(process.getAttribute('id') ?? '');
  }
  if (!title) {
    title = filename.replace(/\.[^/.]+$/, '');
  }

  let description = '';
  if (process) {
    for (const child of Array.from(process.children)) {
      if (child.namespaceURI === NAMESPACES.bpmn && child.localName === 'documentation') {
        description = (child.textContent ?? '').trim();
        break;
      }
    }
  }

  return { title, description };
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function buildInitialEntries(): ExampleEntry[] {
  return Object.entries(exampleFiles)
    .filter(([path, url]) => !path.endsWith('new_diagram.bpmn'))
    .map(([path, url]) => {
      const filename = basename(path);
      return {
        filename,
        url,
        title: filename.replace(/\.[^/.]+$/, ''),
        description: '',
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

export function ExamplesDialog({ ref }: { ref: React.Ref<{ open: () => void }> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState<ExampleEntry[]>(buildInitialEntries);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { modeler } = useContext(ModelerContext);
  const { setDiagramName } = useContext(DiagramNameContext);

  useImperativeHandle(ref, () => ({
    open() {
      setIsOpen(true);
    },
  }), []);

  useEffect(() => {
    if (!isOpen || loaded) return;
    let cancelled = false;

    (async () => {
      const initial = buildInitialEntries();
      const enriched = await Promise.all(
        initial.map(async (entry) => {
          try {
            const content = await fetch(entry.url).then((r) => r.text());
            const { title, description } = parseExampleMetadata(entry.filename, content);
            return { ...entry, title, description, content };
          } catch (err) {
            console.error(`Failed to load example ${entry.filename}:`, err);
            return { ...entry, error: 'Failed to read description.' };
          }
        }),
      );
      if (!cancelled) {
        setEntries(enriched);
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, loaded]);

  function close() {
    setIsOpen(false);
  }

  const selectExample = async (entry: ExampleEntry) => {
    if (!modeler || busy) return;
    setBusy(entry.filename);
    try {
      const content = entry.content ?? (await fetch(entry.url).then((r) => r.text()));
      await executeCommand(modeler, {
        type: 'open-diagram',
        filename: entry.filename,
        content,
        setDiagramName,
      });
      close();
    } catch (err: any) {
      alert(err?.message || 'Failed to load example.');
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={isOpen} onClose={close} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel className={`${d.panelLg} ${d.panel}`}>
            <DialogTitle as="h3" className={`${d.title} pb-3`}>
              Example Diagrams
              <span className={d.closeButton} onClick={close}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            <p className={`${d.body} pb-5`}>
              Your current diagram will be replaced.
            </p>
            {entries.length === 0 ? (
              <p className={e.empty}>No examples available.</p>
            ) : (
              <ul className={e.list}>
                {entries.map((entry) => {
                  const isBusy = busy === entry.filename;
                  return (
                    <li key={entry.filename}>
                      <button
                        type="button"
                        onClick={() => selectExample(entry)}
                        disabled={!!busy}
                        className={e.item}
                      >
                        <div className={e.itemHeader}>
                          <span className={e.itemTitle}>{entry.title}</span>
                          <span className={e.itemFilename}>{entry.filename}</span>
                        </div>
                        {entry.description && (
                          <p className={e.itemDescription}>{entry.description}</p>
                        )}
                        {entry.error && (
                          <p className={e.itemError}>{entry.error}</p>
                        )}
                        {isBusy && (
                          <p className={e.itemBusy}>Loading...</p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
