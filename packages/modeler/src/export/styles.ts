import { ICONS } from '@modeler/icons';
import { border, choice, dialog as d, divider, focusRing, radius, surface, text } from '@modeler/ui/styles';

/** The Save dialog's look, which a skill's destination panel wears too. */
export const saveDialog = {
  row: 'flex items-center gap-3',
  rowLabel: `text-sm font-medium ${text.secondary} shrink-0 w-16`,
  selectWrapper: 'relative flex-1 min-w-0',
  select: `appearance-none w-full px-2.5 py-1.5 pr-8 ${radius.field}
           ${border.control} ${surface.chrome} text-sm text-stone-900 ${focusRing} cursor-pointer`,
  selectChevron: `${ICONS.caretDown} pointer-events-none absolute top-2.5 right-2.5 text-stone-500 text-xs`,
  /** A number among words: the TIFF's width on paper, and its dots per inch. */
  numberField: `w-20 px-2 py-1 ${radius.field} ${border.control} ${surface.chrome} text-sm text-stone-900 text-right ${focusRing}`,
  inline: 'flex-1 flex flex-wrap items-center gap-2 text-sm text-stone-700',

  segmented: `flex-1 flex gap-1 p-1 ${radius.button} ${surface.card}`,
  segment: `flex-1 ${choice.base}`,
  segmentIdle: choice.idle,
  segmentActive: choice.selected,

  fields: `mt-4 pt-4 border-t ${divider.edge} space-y-4`,
  footer: `mt-5 pt-4 border-t ${divider.edge} flex items-center justify-between gap-4`,
  filename: 'font-mono text-xs text-stone-500 truncate',
  primaryBtn: d.primaryBtn,
  error: 'text-xs text-red-500 mt-2',
  status: 'text-xs text-stone-600 mt-2',
} as const;
