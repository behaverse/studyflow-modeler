import { control } from '@modeler/composer/styles';
import { item, material, sectionLabel, space } from '@modeler/ui/styles';

/** The composer's review face, in the composer's control family: what came in, its changes, and the two ways out. */
export const review = {
  label: `${control.label} ${control.mode.review}`,
  /** Opens the change list: the count and the file. */
  summary: `${control.quiet} min-w-0`,
  file: 'font-mono truncate',
  caret: 'shrink-0 text-stone-400',
  list: `z-[240] w-96 max-h-80 overflow-y-auto ${space.list} ${material.menu} ${space.anchor} focus:outline-none`,
  listHeader: `${sectionLabel} ${space.listLabel}`,
  row: `${item.base} ${item.hover} cursor-pointer disabled:cursor-default disabled:hover:bg-transparent`,
  rowName: 'truncate',
  rowWhat: 'ml-auto pl-3 shrink-0 max-w-[12rem] truncate text-xs text-stone-500',
  kind: {
    added: 'shrink-0 text-emerald-700',
    changed: 'shrink-0 text-amber-700',
    removed: 'shrink-0 text-red-700',
  },
  discard: control.secondary,
  accept: control.primary,
} as const;
