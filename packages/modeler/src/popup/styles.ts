import { border, radius, shadow, surface, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

/**
 * The popover every app menu renders into. It borrows the palette flyout's material
 * so a menu opened from the palette and one opened from a shape's context pad look
 * like one family.
 *
 * z-order: palette 210 < context pad 215 < palette flyouts 300 < popover 320.
 */
export const popupMenu = {
  panel: `fixed z-[320] flex flex-col overflow-hidden
          ${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,

  header: `flex items-center gap-2 px-3 h-9 shrink-0 border-b border-black/[0.06]
           text-xs font-semibold uppercase tracking-[0.1em] text-stone-500`,

  searchRow: 'flex items-center gap-2 px-3 h-9 shrink-0 border-b border-black/[0.06]',
  searchIcon: `${ICONS.search} text-stone-500 text-xs shrink-0`,
  searchInput: `flex-1 min-w-0 bg-transparent text-sm ${text.primary} placeholder-stone-400 focus:outline-none`,

  list: 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5',
  empty: 'text-sm text-stone-500 italic py-6 text-center',

  groupLabel: 'text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-stone-500 px-2 pt-2 pb-1 first:pt-0.5',

  item: `touch-pan-y select-none flex items-center gap-2.5 w-full text-left px-2 py-1.5 ${radius.button}
         text-sm ${text.secondary} cursor-grab transition-colors`,
  itemActive: 'bg-black/[0.08] text-stone-900',
  itemIcon: 'shrink-0 w-[1.125rem] h-[1.125rem] flex items-center justify-center text-stone-500',
  itemLabel: 'flex-1 truncate',

  /** One row of unlabelled chips — the swatch names live in each chip's tooltip. */
  swatchGrid: 'flex gap-1 p-1.5',
  swatchItem: `flex items-center justify-center p-1 ${radius.button}
               hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-pointer`,
  swatchItemActive: 'bg-black/[0.08]',
  swatchChip: 'w-6 h-6 rounded-md border-2',
} as const;

