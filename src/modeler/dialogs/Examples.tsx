import { useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { looksLikeXml, readStudyflowMetadata } from '@/lib/core/codec';
import { useModeler } from '../useModeler';
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

function parseXmlExampleMetadata(text: string): { name?: string; id?: string; description?: string } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

  const process = doc.getElementsByTagNameNS(NAMESPACES.bpmn, 'process')[0]
    ?? doc.getElementsByTagNameNS(NAMESPACES.core, 'study')[0];
  if (!process) return {};

  return {
    name: process.getAttribute('name')?.trim() || undefined,
    id: process.getAttribute('id') ?? undefined,
    description: Array.from(process.children).find(
      (c) => c.namespaceURI === NAMESPACES.bpmn && c.localName === 'documentation',
    )?.textContent?.trim() || undefined,
  };
}

/** Examples ship as YAML `.studyflow`; `.bpmn`/`.svg` (and legacy files) are XML. */
function parseExampleMetadata(filename: string, text: string): { title: string; description: string } {
  const meta = looksLikeXml(text) ? parseXmlExampleMetadata(text) : readStudyflowMetadata(text);
  const title = meta.name
    || (meta.id ? humanizeId(meta.id) : '')
    || filename.replace(/\.[^/.]+$/, '');
  return { title, description: meta.description ?? '' };
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function buildInitialEntries(): ExampleEntry[] {
  return Object.entries(exampleFiles)
    .filter(([path]) => !path.endsWith('new_diagram.bpmn'))
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

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function ExamplesDialog({ isOpen, onClose }: Props) {
  const [entries, setEntries] = useState<ExampleEntry[]>(buildInitialEntries);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const modeler = useModeler();

  useEffect(() => {
    if (!isOpen || loaded) return;
    let cancelled = false;

    (async () => {
      const enriched = await Promise.all(
        buildInitialEntries().map(async (entry) => {
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

  const selectExample = async (entry: ExampleEntry) => {
    if (!modeler || busy) return;
    setBusy(entry.filename);
    try {
      const content = entry.content ?? (await fetch(entry.url).then((r) => r.text()));
      await executeCommand(modeler, {
        type: 'open-diagram',
        filename: entry.filename,
        content,
      });
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Failed to load example.');
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel className={`${d.panelLg} ${d.panel}`}>
            <DialogTitle as="h3" className={`${d.title} pb-3`}>
              Example Diagrams
              <span className={d.closeButton} onClick={onClose}>
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
