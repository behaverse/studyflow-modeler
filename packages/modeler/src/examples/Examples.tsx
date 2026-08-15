import { notify } from '@modeler/app/noticeStore';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import {
  buildInitialEntries,
  loadExampleEntries,
  type ExampleEntry,
} from '@modeler/examples/entries';
import { galleryTags, hasTag, primaryTagOf } from '@modeler/examples/catalog';
import { filenameStem } from '@modeler/diagram/file';
import { surface, radius } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

const g = {
  filters: 'flex flex-wrap items-center gap-1.5 pb-4 shrink-0',
  chip: `px-3 py-1 ${radius.pill} text-[12.5px] border transition-colors cursor-pointer`,
  chipIdle: 'border-black/[0.06] text-stone-600 hover:bg-black/[0.04]',
  chipActive: 'bg-stone-900 border-stone-900 text-cream-50',

  grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5
         flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1 content-start`,
  empty: 'text-sm text-stone-500 italic py-10 text-center',

  card: `group w-full h-full flex flex-col text-left overflow-hidden ${radius.card} ${surface.card}
         border border-black/[0.06] hover:border-black/[0.14] hover:shadow-[0_2px_6px_rgba(0,0,0,0.05),0_12px_28px_rgba(0,0,0,0.09)]
         disabled:cursor-not-allowed transition-all duration-200 cursor-pointer`,

  thumb: 'relative w-full aspect-[16/9] bg-white border-b border-black/[0.06] flex items-center justify-center overflow-hidden',
  thumbImage: 'max-h-full max-w-full object-contain p-3 transition-transform duration-300 ease-out group-hover:scale-[1.04]',
  thumbBusy: 'absolute inset-0 flex items-center justify-center bg-white/70',
  thumbSpinner: `${ICONS.arrowRepeat} text-stone-500 animate-spin`,

  body: 'flex flex-col gap-1 px-3.5 py-3',
  eyebrow: 'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-stone-400',
  title: 'text-[13.5px] font-semibold tracking-tight text-stone-900 line-clamp-2',
  summary: 'text-[12.5px] leading-snug text-stone-500 line-clamp-2',
  error: 'text-[12.5px] text-red-500',
} as const;

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

    loadExampleEntries().then((read) => {
      if (cancelled) return;
      setEntries(read);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, loaded]);

  const shelves = useMemo(
    () => galleryTags(entries.map((entry) => entry.tags)),
    [entries],
  );
  const visible = filter === 'all'
    ? entries
    : entries.filter((entry) => hasTag(entry.tags, filter));

  const selectExample = async (entry: ExampleEntry) => {
    if (!modeler || busy) return;
    setBusy(entry.filename);
    try {
      const content = await fetch(entry.url).then((r) => r.arrayBuffer());
      await executeCommand(modeler, {
        type: 'OpenDiagram',
        filename: entry.filename,
        content,
      });
      onClose();
    } catch (err: any) {
      notify('error', err?.message || 'Could not open the example. Try another, or reload the page.');
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Examples"
      size="xl"
      testId="examples-dialog"
    >

            <div className={g.filters}>
              {['all', ...shelves].map((shelf) => (
                <button
                  key={shelf}
                  type="button"
                  data-testid={`example-filter-${shelf}`}
                  aria-pressed={filter === shelf}
                  onClick={() => setFilter(shelf)}
                  className={`${g.chip} ${filter === shelf ? g.chipActive : g.chipIdle}`}
                >
                  {shelf === 'all' ? 'All' : shelf}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className={g.empty}>
                {filter === 'all' ? 'No examples in this build.' : 'Pick another above.'}
              </p>
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
                        {entry.tags.length > 0 && (
                          <span className={g.eyebrow}>{primaryTagOf(entry.tags)}</span>
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
    </Modal>
  );
}
