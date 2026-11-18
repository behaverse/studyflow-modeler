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
import { SCHEMA_MODELS, skillOfSchema } from '@core/notation/loader';
import { filenameStem } from '@modeler/diagram/file';
import { border, choice, dialog as d, divider, radius, sectionLabel, surface } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';
import { Question } from '@modeler/gallery/Question';

const g = {
  or: `${sectionLabel} mb-2 shrink-0`,
  filters: 'flex flex-wrap items-center gap-1 mb-4 shrink-0',
  chip: choice.base,
  chipIdle: choice.idle,
  chipActive: choice.selected,

  grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4
         flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1 content-start`,
  empty: 'text-sm text-stone-500 italic py-10 text-center',

  card: `group w-full h-full flex flex-col text-left overflow-hidden ${radius.card} ${surface.card}
         ${border.hairline} hover:border-black/[0.14] hover:shadow-[0_2px_6px_rgba(0,0,0,0.05),0_12px_28px_rgba(0,0,0,0.09)]
         disabled:cursor-not-allowed transition-all duration-200 cursor-pointer`,

  thumb: `relative w-full aspect-[16/9] ${surface.card} border-b ${divider.edge} flex items-center justify-center overflow-hidden`,
  thumbImage: 'max-h-full max-w-full object-contain p-3 transition-transform duration-300 ease-out group-hover:scale-[1.04]',
  thumbBusy: 'absolute inset-0 flex items-center justify-center bg-field/70',
  thumbSpinner: `${ICONS.spinner} text-stone-500 animate-spin`,
  // The skill's schema icon, pinned to the picture's corner so it reads as where the example comes from.
  badge: `absolute top-2 start-2 flex size-6 items-center justify-center ${radius.button} bg-field/90 text-stone-500 ring-1 ring-black/[0.10]`,

  body: 'flex flex-col gap-1 px-4 py-3',
  eyebrow: sectionLabel,
  title: 'text-sm font-semibold tracking-tight text-stone-900 line-clamp-2',
  error: d.error,

  blankThumb: `relative w-full aspect-[16/9] ${surface.card} border-b ${divider.edge} flex items-center justify-center`,
  blankIcon: 'text-[2rem] text-stone-300 group-hover:text-stone-400 transition-colors',
} as const;

/** A shelf's name as the dialog shows it: its skill's schema's name (`Reachy Mini`), else the skill's, capitalized. */
function shelfLabel(shelf: string): string {
  const schema = SCHEMA_MODELS.find((model) => skillOfSchema(model.prefix)?.name === shelf);
  return schema?.name ?? shelf.replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase());
}

/** Busy key for the one card that opens no file. */
const BLANK = '__blank';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function GalleryDialog({ isOpen, onClose }: Props) {
  const [entries, setEntries] = useState<ExampleEntry[]>(buildInitialEntries);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const modeler = useModeler();

  useEffect(() => {
    if (!isOpen || !modeler) return;
    let cancelled = false;

    loadExampleEntries(modeler.model.metamodel()).then((read) => {
      if (!cancelled) setEntries(read);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, modeler]);

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
      notify('error', err?.message || 'Could not start an empty study. Reload the page and try again.');
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  const selectExample = async (entry: ExampleEntry) => {
    if (!modeler || busy) return;
    setBusy(entry.filename);
    try {
      const content = await (await fetch(entry.url)).arrayBuffer();
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
      title="New Study"
      size="xl"
      testId="gallery-dialog"
    >

            <Question onDone={onClose} />
            <p className={g.or}>Or start from an example</p>
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
                  {shelf === 'all' ? 'All' : shelfLabel(shelf)}
                </button>
              ))}
            </div>

            <ul className={g.grid}>
              <li key={BLANK}>
                <button
                  type="button"
                  data-testid="new-diagram-blank"
                  aria-label="Empty study"
                  onClick={startBlank}
                  disabled={!!busy}
                  className={g.card}
                >
                  <div className={g.blankThumb}>
                    <i className={`${busy === BLANK ? g.thumbSpinner : ICONS.fileNew} ${g.blankIcon}`}></i>
                  </div>
                  <div className={g.body}>
                    <span className={g.eyebrow}>Blank</span>
                    <span className={g.title}>Empty study</span>
                  </div>
                </button>
              </li>
              {visible.map((entry) => (
                <li key={entry.filename}>
                    <button
                      type="button"
                      data-testid={`example-${filenameStem(entry.filename)}`}
                      aria-label={entry.title}
                      title={entry.summary || entry.filename}
                      onClick={() => selectExample(entry)}
                      disabled={!!busy}
                      className={g.card}
                    >
                      <div className={g.thumb}>
                        {entry.thumb && (
                          <img src={entry.thumb} alt="" loading="lazy" data-testid="example-thumb" className={g.thumbImage} />
                        )}
                        {entry.badge && (
                          <span className={g.badge} data-testid="example-badge" aria-hidden="true">
                            <PaletteIcon icon={entry.badge} size={14} />
                          </span>
                        )}
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
                        {entry.error && <span className={g.error}>{entry.error}</span>}
                      </div>
                    </button>
                  </li>
              ))}
            </ul>
    </Modal>
  );
}
