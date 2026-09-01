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
import { galleryCategories } from '@modeler/examples/catalog';
import { filenameStem } from '@modeler/diagram/file';
import { surface, radius, button } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

const g = {
  filters: 'flex flex-wrap items-center gap-1.5 pb-4 shrink-0',
  // Pushed to its own end of the row: starting from nothing is not one of the shelves. Wears the
  // nav bar's action look, so the one button here that acts reads like the ones that act there.
  blankButton: `ms-auto ${button.action} ${button.accentFill} ${radius.button}`,
  blankButtonIcon: 'text-[14px]',
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

  blankThumb: 'relative w-full aspect-[16/9] bg-white border-b border-black/[0.06] flex items-center justify-center',
  blankIcon: 'text-[2rem] text-stone-300 group-hover:text-stone-400 transition-colors',
} as const;

/** Busy key for the one card that opens no file. */
const BLANK = '__blank';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function GalleryDialog({ isOpen, onClose }: Props) {
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
    () => galleryCategories(entries.map((entry) => entry.category)),
    [entries],
  );
  const visible = filter === 'all'
    ? entries
    : entries.filter((entry) => entry.category === filter);

  const startBlank = async () => {
    if (!modeler || busy) return;
    setBusy(BLANK);
    try {
      await executeCommand(modeler, { type: 'NewDiagram' });
      onClose();
    } catch (err: any) {
      notify('error', err?.message || 'Could not start an empty diagram. Reload the page and try again.');
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  const selectExample = async (entry: ExampleEntry) => {
    if (!modeler || busy) return;
    setBusy(entry.filename);
    try {
      const content = entry.content ?? await (await fetch(entry.url!)).arrayBuffer();
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
      title="New Diagram"
      size="xl"
      testId="gallery-dialog"
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
              <button
                type="button"
                data-testid="new-diagram-blank"
                onClick={startBlank}
                disabled={!!busy}
                className={g.blankButton}
              >
                <i
                  className={`${busy === BLANK ? ICONS.arrowRepeat + ' animate-spin' : ICONS.fileNew} ${g.blankButtonIcon}`}
                  aria-hidden="true"
                ></i>
                Empty diagram
              </button>
            </div>

            <ul className={g.grid}>
              {filter === 'all' && (
              <li key={BLANK}>
                <button
                  type="button"
                  data-testid="new-diagram-blank-card"
                  aria-label="Empty diagram"
                  onClick={startBlank}
                  disabled={!!busy}
                  className={g.card}
                >
                  <div className={g.blankThumb}>
                    <i className={`${busy === BLANK ? g.thumbSpinner : ICONS.fileNew} ${g.blankIcon}`}></i>
                  </div>
                  <div className={g.body}>
                    <span className={g.eyebrow}>Blank</span>
                    <span className={g.title}>Empty diagram</span>
                    <span className={g.summary}>One start event on an empty canvas. Build the rest from the palette.</span>
                  </div>
                </button>
              </li>
              )}
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
                      <div className={entry.url ? g.thumb : g.blankThumb}>
                        {entry.url
                          ? <img src={entry.url} alt="" loading="lazy" className={g.thumbImage} />
                          : <i className={`${entry.iconClass ?? ICONS.fileNew} ${g.blankIcon}`}></i>}
                        {busy === entry.filename && (
                          <span className={g.thumbBusy}>
                            <i className={g.thumbSpinner}></i>
                          </span>
                        )}
                      </div>
                      <div className={g.body}>
                        {entry.category && (
                          <span className={g.eyebrow}>{entry.category}</span>
                        )}
                        <span className={g.title}>{entry.title}</span>
                        {entry.summary && <span className={g.summary}>{entry.summary}</span>}
                        {entry.error && <span className={g.error}>{entry.error}</span>}
                      </div>
                    </button>
                  </li>
              ))}
            </ul>
    </Modal>
  );
}
