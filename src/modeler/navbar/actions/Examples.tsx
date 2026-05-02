import { forwardRef, useContext, useEffect, useImperativeHandle, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { DiagramNameContext, ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

const exampleFiles = import.meta.glob(
  '@/assets/examples/*.{studyflow,bpmn}',
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

  const process = doc.getElementsByTagNameNS(BPMN_NS, 'process')[0];

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
      if (child.namespaceURI === BPMN_NS && child.localName === 'documentation') {
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
    <Dialog open={isOpen} onClose={close} className="relative z-[101] focus:outline-none">
      <div className="fixed backdrop-blur inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel className="w-full max-w-2xl rounded-xl bg-stone-100 p-6 backdrop-blur-2xl duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]">
            <DialogTitle as="h3" className="text-base/7 text-stone-900 font-semibold pb-4">
              Examples
              <span className="text-sm/6 text-black ml-2 float-end cursor-pointer" onClick={close}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            <p className="text-sm text-stone-600 pb-4">
              Pick a diagram to load it into the editor. Your current diagram will be replaced.
            </p>
            {entries.length === 0 ? (
              <p className="text-sm text-stone-500 italic py-8 text-center">No examples available.</p>
            ) : (
              <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
                {entries.map((entry) => {
                  const isBusy = busy === entry.filename;
                  return (
                    <li key={entry.filename}>
                      <button
                        type="button"
                        onClick={() => selectExample(entry)}
                        disabled={!!busy}
                        className="w-full text-left rounded-lg bg-stone-200 hover:bg-stone-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors p-4 cursor-pointer"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-semibold text-stone-900">{entry.title}</span>
                          <span className="font-mono text-xs text-stone-500 shrink-0">{entry.filename}</span>
                        </div>
                        {entry.description && (
                          <p className="text-sm text-stone-600 mt-1 line-clamp-3">{entry.description}</p>
                        )}
                        {entry.error && (
                          <p className="text-sm text-red-500 mt-1">{entry.error}</p>
                        )}
                        {isBusy && (
                          <p className="text-xs text-stone-500 mt-1">Loading…</p>
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

export const ExamplesButton = forwardRef<HTMLButtonElement, { className?: string; onClick?: () => void; dialog?: React.RefObject<{ open: () => void } | null> }>(
  function ExamplesButton({ className, onClick, dialog }, ref) {
    return (
      <button
        ref={ref}
        title="Open an example diagram"
        className={`w-full text-left ${className ?? ''}`}
        onClick={() => {
          dialog?.current?.open();
          onClick?.();
        }}
      >
        <i className="iconify bi--collection pe-2"></i> Examples...
      </button>
    );
  },
);
