import { filenameStem } from '@modeler/diagram/file';
import { text } from '@modeler/ui/styles';

const s = {
  whole: 'font-mono',
  row: 'flex min-w-0 font-mono',
  stem: 'truncate',
  extension: `shrink-0 ${text.muted}`,
} as const;

/** A file's name with its extension kept whole: with `truncate`, a long name gives way in its stem. */
export function FileName({ name, truncate = false }: { name: string; truncate?: boolean }) {
  const stem = filenameStem(name);
  return (
    <span className={truncate ? s.row : s.whole}>
      <span className={truncate ? s.stem : undefined}>{stem}</span>
      <span className={s.extension}>{name.slice(stem.length)}</span>
    </span>
  );
}
