/**
 * The New dialog, a start page: a box for describing a study in words (not built yet), the empty study and the
 * templates the skills feature, and the files opened lately. All templates turns the page to every shipped example, in
 * shelves by skill.
 */
import { useEffect, useMemo, useState } from 'react';
import { SCHEMA_MODELS, skillOfSchema } from '@core/notation/loader';
import { notify } from '@modeler/app/noticeStore';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { filenameStem } from '@modeler/diagram/file';
import { supportsFileSystemAccess } from '@modeler/diagram/fileHandle';
import { recentFiles, type RecentFile } from '@modeler/diagram/recentFiles';
import { galleryCategories, leadingExamples } from '@modeler/examples/catalog';
import { buildInitialEntries, loadExampleEntries, type ExampleEntry } from '@modeler/examples/entries';
import { Prompt } from '@modeler/gallery/Prompt';
import { Recents } from '@modeler/gallery/Recents';
import { ICONS } from '@modeler/icons';
import { openRecentFile } from '@modeler/open/openFile';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';
import { Modal } from '@modeler/ui/Modal';
import { border, choice, dialog as d, divider, radius, sectionLabel, surface } from '@modeler/ui/styles';

const g = {
  /** The start page scrolls as one where the window is short. */
  page: 'flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto -mx-3 px-3 pb-1',
  head: 'flex items-center justify-between h-6 mb-2',
  label: sectionLabel,
  all: `${choice.base} ${choice.idle} -me-2`,
  /** The empty study and the templates the page leads with, in one row. */
  row: 'grid grid-cols-2 sm:grid-cols-4 gap-3',

  filters: 'flex flex-wrap items-center gap-1 mb-4 shrink-0',
  back: `${choice.base} ${choice.idle} -ms-2`,
  rule: `${divider.vertical} mx-1`,
  chip: choice.base,
  chipIdle: choice.idle,
  chipActive: choice.selected,
  grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4
         flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1 content-start`,

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

  blankIcon: 'text-[2rem] text-stone-300 group-hover:text-stone-400 transition-colors',
} as const;

/** A shelf's name as the dialog shows it: its skill's schema's name (`Reachy Mini`), else the skill's, capitalized. */
function shelfLabel(shelf: string): string {
  const schema = SCHEMA_MODELS.find((model) => skillOfSchema(model.prefix)?.name === shelf);
  return schema?.name ?? shelf.replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase());
}

/** What is opening: a card by its key, or a recent file. One thing opens at a time. */
type Opening = string | RecentFile | null;

/** The key of the one card that opens no file. */
const BLANK = '__blank';
/** How many templates the start page shows beside the empty study. */
const LEADING = 3;

type CardsProps = {
  entries: ExampleEntry[];
  opening: Opening;
  onBlank: () => void;
  onExample: (entry: ExampleEntry) => void;
};

/** The empty study, then a card per example: the items of the start page's row and of a shelf's grid. */
function Cards({ entries, opening, onBlank, onExample }: CardsProps) {
  return (
    <>
      <li>
        <button
          type="button"
          data-testid="new-diagram-blank"
          aria-label="Empty study"
          onClick={onBlank}
          disabled={!!opening}
          className={g.card}
        >
          <div className={g.thumb}>
            <i className={`${opening === BLANK ? g.thumbSpinner : ICONS.fileNew} ${g.blankIcon}`}></i>
          </div>
          <div className={g.body}>
            <span className={g.eyebrow}>Blank</span>
            <span className={g.title}>Empty study</span>
          </div>
        </button>
      </li>
      {entries.map((entry) => (
        <li key={entry.filename}>
          <button
            type="button"
            data-testid={`example-${filenameStem(entry.filename)}`}
            aria-label={entry.title}
            title={entry.summary || entry.filename}
            onClick={() => onExample(entry)}
            disabled={!!opening}
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
              {opening === entry.filename && (
                <span className={g.thumbBusy}>
                  <i className={g.thumbSpinner}></i>
                </span>
              )}
            </div>
            <div className={g.body}>
              {entry.category && (
                <span className={g.eyebrow}>{shelfLabel(entry.category)}</span>
              )}
              <span className={g.title}>{entry.title}</span>
              {entry.error && <span className={g.error}>{entry.error}</span>}
            </div>
          </button>
        </li>
      ))}
    </>
  );
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function GalleryDialog({ isOpen, onClose }: Props) {
  const [entries, setEntries] = useState<ExampleEntry[]>(buildInitialEntries);
  /** The recent files, once read. */
  const [recents, setRecents] = useState<RecentFile[]>();
  const [opening, setOpening] = useState<Opening>(null);
  const [view, setView] = useState<'start' | 'templates'>('start');
  /** The page was turned by hand, so the button that turns it back takes the focus the pressed one gave up. */
  const [turned, setTurned] = useState(false);
  const [filter, setFilter] = useState('all');
  const modeler = useModeler();

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    loadExampleEntries(modeler.model.metamodel()).then((read) => {
      if (!cancelled) setEntries(read);
    });
    recentFiles().then((read) => {
      if (!cancelled) setRecents(read);
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

  /** Opens one thing and closes the dialog behind it; `what` shows it opening, and nothing else opens meanwhile. */
  const open = async (what: NonNullable<Opening>, opens: () => Promise<boolean>, failure: string) => {
    if (opening) return;
    setOpening(what);
    try {
      if (await opens()) onClose();
    } catch (err: any) {
      notify('error', err?.message || failure);
      console.error(err);
    } finally {
      setOpening(null);
    }
  };

  const startBlank = () => open(BLANK, async () => {
    await executeCommand(modeler, { type: 'NewDiagram' });
    return true;
  }, 'Could not start an empty study. Reload the page and try again.');

  const selectExample = (entry: ExampleEntry) => open(entry.filename, async () => {
    const content = await (await fetch(entry.url)).arrayBuffer();
    await executeCommand(modeler, { type: 'OpenDiagram', filename: entry.filename, content });
    return true;
  }, 'Could not open the template. Try another, or reload the page.');

  const openRecent = (file: RecentFile) => open(file, async () => {
    const opened = await openRecentFile(modeler, file);
    // A file that was not there has left the list.
    if (!opened) setRecents(await recentFiles());
    return opened;
  }, `Could not open ${file.name}.`);

  const turnTo = (next: typeof view) => {
    setView(next);
    setTurned(true);
  };

  const cards = { opening, onBlank: startBlank, onExample: selectExample };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Study"
      size="lg"
      testId="gallery-dialog"
    >
      {view === 'start' ? (
        <div className={g.page}>
          <Prompt />
          <section aria-label="Templates">
            <div className={g.head}>
              <h4 className={g.label}>Templates</h4>
              <button type="button" autoFocus={turned} className={g.all} onClick={() => turnTo('templates')}>
                All templates
                <i className={ICONS.chevronRight} aria-hidden="true" />
              </button>
            </div>
            <ul className={g.row}>
              <Cards entries={leadingExamples(entries, LEADING)} {...cards} />
            </ul>
          </section>
          {/* A browser without the file pickers keeps no files, so it shows the list only when a server gave one. */}
          {recents && (recents.length > 0 || supportsFileSystemAccess()) && (
            <Recents
              files={recents}
              opening={recents.find((file) => file === opening)}
              disabled={!!opening}
              onOpen={openRecent}
            />
          )}
        </div>
      ) : (
        <>
          <div className={g.filters}>
            <button type="button" autoFocus className={g.back} onClick={() => turnTo('start')}>
              <i className={ICONS.chevronLeft} aria-hidden="true" />
              Back
            </button>
            <span className={g.rule} aria-hidden="true" />
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
            <Cards entries={visible} {...cards} />
          </ul>
        </>
      )}
    </Modal>
  );
}
