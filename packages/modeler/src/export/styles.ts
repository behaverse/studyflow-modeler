import { ICONS } from '@modeler/icons';
import { dialog as d, radius, text } from '@modeler/ui/styles';

/** The Save dialog's look, which a skill's destination panel wears too. */
export const saveDialog = {
  row: 'flex items-center gap-3',
  rowLabel: `text-[13px] font-medium ${text.secondary} shrink-0 w-16`,
  selectWrapper: 'relative flex-1 min-w-0',
  select: `appearance-none w-full px-2.5 py-1.5 pr-8 ${radius.field}
           border border-black/[0.08] bg-cream-100 text-[13px] text-stone-900
           focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400 cursor-pointer`,
  selectChevron: `${ICONS.caretDown} pointer-events-none absolute top-2.5 right-2.5 text-stone-500 text-[12px]`,

  segmented: `flex-1 flex gap-1 p-1 ${radius.field} bg-cream-200`,
  segment: `flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 ${radius.field}
            text-[12.5px] font-medium transition-colors cursor-pointer`,
  segmentIdle: 'text-stone-600 hover:bg-black/[0.04]',
  segmentActive: 'bg-cream-50 text-stone-900 shadow-[0_1px_2px_rgba(0,0,0,0.06)]',

  fields: 'mt-4 pt-4 border-t border-black/[0.06] space-y-4',
  footer: 'mt-5 pt-4 border-t border-black/[0.06] flex items-center justify-between gap-4',
  filename: 'font-mono text-[12px] text-stone-500 truncate',
  primaryBtn: `inline-flex items-center gap-2 shrink-0 ${d.primaryBtn} disabled:opacity-50`,
  error: 'text-[12px] text-red-500 mt-2',
  status: 'text-[12px] text-stone-600 mt-2',
} as const;
