import { border, radius, shadow, surface, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

/**
 * The React popover that replaces `.djs-popup` on the canvas backend, and the
 * selection toolbar that opens it. Both borrow the palette flyout's material so a
 * menu opened from the palette and one opened from a shape look like one family.
 *
 * z-order: palette 210 < selection toolbar 215 < palette flyouts 300 < popover 320.
 */
export const popupMenu = {
  panel: `fixed z-[320] flex flex-col overflow-hidden
          ${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,

  header: `flex items-center gap-2 px-3 h-9 shrink-0 border-b border-black/[0.06]
           text-xs font-semibold uppercase tracking-[0.1em] text-stone-500`,

  searchRow: 'flex items-center gap-2 px-3 h-9 shrink-0 border-b border-black/[0.06]',
  searchIcon: `${ICONS.search} text-stone-400 text-[12px] shrink-0`,
  searchInput: `flex-1 min-w-0 bg-transparent text-[13px] ${text.primary} placeholder-stone-400 focus:outline-none`,

  list: 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5',
  empty: 'text-[13px] text-stone-500 italic py-6 text-center',

  groupLabel: 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-400 px-2 pt-2 pb-1 first:pt-0.5',

  item: `flex items-center gap-2.5 w-full text-left px-2 py-1.5 ${radius.button}
         text-[13px] ${text.secondary} cursor-grab transition-colors`,
  itemActive: 'bg-black/[0.06] text-stone-900',
  itemIcon: 'shrink-0 w-[18px] h-[18px] flex items-center justify-center text-stone-500',
  itemLabel: 'flex-1 truncate',

  swatchGrid: 'grid grid-cols-3 gap-1 p-2',
  swatchItem: `flex flex-col items-center justify-center gap-1 p-2 ${radius.button}
               text-[11.5px] text-stone-600 hover:text-stone-900 hover:bg-black/[0.05]
               active:bg-black/[0.08] transition-colors cursor-pointer`,
  swatchItemActive: 'bg-black/[0.06] text-stone-900',
  swatchChip: 'w-5 h-5 rounded-[3px] border-2',
} as const;

export const selectionToolbar = {
  /**
   * A narrow vertical strip hugging the selection's right edge — deliberately the
   * geometry and footprint of diagram-js's context pad, which is what sits here on
   * the other backend. A wide horizontal bar over the shape swallows clicks meant
   * for its neighbours.
   */
  root: `fixed z-[215] left-0 top-0 flex flex-col items-center gap-0.5 p-0.5
         ${radius.button} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}`,

  button: `flex items-center justify-center w-7 h-7 ${radius.field}
           text-stone-600 cursor-pointer
           hover:bg-black/[0.06] hover:text-stone-900 active:bg-black/[0.1]
           disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent
           transition-colors`,

  buttonIcon: 'text-[14px]',
  colorChip: 'w-[14px] h-[14px] rounded-[3px] border-2 border-stone-500 bg-transparent',
} as const;
