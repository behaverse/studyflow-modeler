import type { RecentFile } from '@modeler/diagram/recentFiles';
import { ICONS } from '@modeler/icons';
import { FileName } from '@modeler/ui/FileName';
import { dialog as d, item, sectionLabel } from '@modeler/ui/styles';

const s = {
  label: `${sectionLabel} flex items-center h-6 mb-1`,
  row: `${item.base} enabled:hover:bg-black/[0.05] enabled:hover:text-stone-900 enabled:cursor-pointer`,
  icon: 'shrink-0 text-stone-500',
  name: 'flex flex-1 min-w-0 text-xs',
  when: 'shrink-0 text-[0.6875rem] text-stone-500',
  /** The rows' own padding hangs outside the page's edge, so their names stand under the label. */
  list: '-mx-2.5',
  empty: d.empty,
} as const;

type Props = {
  files: RecentFile[];
  /** The file being opened, while it is; nothing else opens meanwhile. */
  opening?: RecentFile;
  disabled: boolean;
  onOpen: (file: RecentFile) => void;
};

/** The New dialog's recent files (`diagram/recentFiles.ts`), newest first: a press opens one again. */
export function Recents({ files, opening, disabled, onOpen }: Props) {
  return (
    <section aria-label="Recent" data-testid="recent-files">
      <h4 className={s.label}>Recent</h4>
      {files.length === 0 && <p className={s.empty}>No recent files</p>}
      <ul className={s.list}>
        {files.map((file, index) => (
          // Two files in different folders can share a name, and a handle shows no path: the place in the list tells them apart.
          <li key={index}>
            <button type="button" className={s.row} disabled={disabled} onClick={() => onOpen(file)}>
              <i className={`${file === opening ? `${ICONS.spinner} animate-spin` : ICONS.document} ${s.icon}`} aria-hidden="true" />
              <span className={s.name}><FileName name={file.name} truncate /></span>
              <time className={s.when} dateTime={new Date(file.openedAt).toISOString()}>
                {new Date(file.openedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
