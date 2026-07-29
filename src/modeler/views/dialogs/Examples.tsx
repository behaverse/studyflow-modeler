import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '@/modeler/views/useModeler';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { basename, readExampleMetadata } from '@/modeler/models/dialogs/exampleMetadata';
import {
  compareExamples,
  galleryCategories,
  isInCategory,
  primaryCategoryOf,
} from '@/modeler/models/dialogs/exampleCatalog';
import { filenameStem } from '@/modeler/models/diagramFile';
import { dialog as d, exampleGallery as g } from '@/modeler/infra/styles';
import { namespaces } from '@/modeler/infra/constants';
import { ICONS } from '@/icons';

/**
 * Every shipped example, as one PNG each: the card's picture *is* the diagram
 * (its studyflow rides in a metadata chunk — see `exporters/pngEmbedding`), so
 * the image the user is looking at is the file that opens when they click it.
 *
 * Titles, blurbs, and categories are read out of those same files, which is
 * why adding an example is one drop into `@/assets/examples/` and nothing else.
 */
const exampleFiles = import.meta.glob(
  '@/assets/examples/*.png',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

type ExampleEntry = {
  filename: string;
  url: string;
  title: string;
  /** One sentence, from the diagram's own documentation. */
  summary: string;
  /** Shelves the diagram files itself under; a card appears under each. */
  categories: string[];
  error?: string;
};

/** Cards before their diagrams have been read: the picture and the file name
 *  are enough to paint the grid, and the rest arrives a moment later. */
function buildInitialEntries(): ExampleEntry[] {
  return Object.entries(exampleFiles)
    .map(([path, url]) => {
      const filename = basename(path);
      return {
        filename,
        url,
        title: filenameStem(filename),
        summary: '',
        categories: [],
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
  const [filter, setFilter] = useState('all');
  const modeler = useModeler();

  useEffect(() => {
    if (!isOpen || loaded) return;
    let cancelled = false;

    (async () => {
      const read = await Promise.all(
        buildInitialEntries().map(async (entry) => {
          try {
            // The same bytes the <img> is showing; the browser serves both
            // from one response.
            const png = await fetch(entry.url).then((r) => r.arrayBuffer());
            return { ...entry, ...readExampleMetadata(entry.filename, png, namespaces()) };
          } catch (err) {
            console.error(`Failed to read example ${entry.filename}:`, err);
            return { ...entry, error: 'Failed to read this example.' };
          }
        }),
      );
      if (!cancelled) {
        setEntries(read.sort(compareExamples));
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, loaded]);

  const categories = useMemo(
    () => galleryCategories(entries.map((entry) => entry.categories)),
    [entries],
  );
  const visible = filter === 'all'
    ? entries
    : entries.filter((entry) => isInCategory(entry.categories, filter));

  const selectExample = async (entry: ExampleEntry) => {
    if (!modeler || busy) return;
    setBusy(entry.filename);
    try {
      const content = await fetch(entry.url).then((r) => r.arrayBuffer());
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
          <DialogPanel className={`${d.panelXl} ${d.panel}`} data-testid="examples-dialog">
            <DialogTitle as="h3" className={`${d.title} pb-3`}>
              Examples
              <span className={d.closeButton} onClick={onClose}>
                <i className={ICONS.close}></i>
              </span>
            </DialogTitle>

            <div className={g.filters}>
              {['all', ...categories].map((category) => (
                <button
                  key={category}
                  type="button"
                  data-testid={`example-filter-${category}`}
                  aria-pressed={filter === category}
                  onClick={() => setFilter(category)}
                  className={`${g.chip} ${filter === category ? g.chipActive : g.chipIdle}`}
                >
                  {category === 'all' ? 'All' : category}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className={g.empty}>No examples available.</p>
            ) : (
              <ul className={g.grid}>
                {visible.map((entry) => (
                  <li key={entry.filename}>
                    <button
                      type="button"
                      data-testid={`example-${filenameStem(entry.filename)}`}
                      aria-label={entry.title}
                      title={entry.filename}
                      onClick={() => selectExample(entry)}
                      disabled={!!busy}
                      className={g.card}
                    >
                      <div className={g.thumb}>
                        <img src={entry.url} alt="" loading="lazy" className={g.thumbImage} />
                        {busy === entry.filename && (
                          <span className={g.thumbBusy}>
                            <i className={g.thumbSpinner}></i>
                          </span>
                        )}
                      </div>
                      <div className={g.body}>
                        {entry.categories.length > 0 && (
                          <span className={g.eyebrow}>{primaryCategoryOf(entry.categories)}</span>
                        )}
                        <span className={g.title}>{entry.title}</span>
                        {entry.summary && <span className={g.summary}>{entry.summary}</span>}
                        {entry.error && <span className={g.error}>{entry.error}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
