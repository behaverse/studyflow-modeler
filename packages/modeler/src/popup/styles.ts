import { divider, item, material, radius, sectionLabel, space, text } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

/**
 * The popover every app menu renders into. It borrows the palette flyout's material
 * so a menu opened from the palette and one opened from a shape's context pad look
 * like one family.
 *
 * z-order: palette 210 < context pad 215 < palette flyouts 300 < popover 320.
 */
export const popupMenu = {
  panel: `fixed z-[320] flex flex-col overflow-hidden ${material.menu}`,

  header: `flex items-center gap-2 px-4 h-10 shrink-0 border-b ${divider.edge} ${sectionLabel}`,

  searchRow: `flex items-center gap-2 px-4 h-10 shrink-0 border-b ${divider.edge}`,
  searchIcon: `${ICONS.search} text-stone-500 text-xs shrink-0`,
  searchInput: `flex-1 min-w-0 bg-transparent text-sm ${text.primary} placeholder-stone-400 focus:outline-none`,

  /** Under the search, ruled off from the list: the switch between a menu's views, then its filters. */
  controls: `shrink-0 flex flex-col gap-1.5 ${space.list} border-b ${divider.edge}`,
  /** One half of the switch: the halves share the panel's width. */
  view: 'flex-1',
  /** The filters, wrapped onto as many rows as they need, their words in line with the search's. */
  filters: 'flex flex-wrap gap-1',

  list: 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5',
  empty: 'text-sm text-stone-500 italic py-6 text-center',

  groupLabel: `${sectionLabel} px-2.5 pt-2 pb-1 first:pt-0.5`,

  /** A row: its pick spans it, a pin (the Add panel's) sits at its end. 32 tall, as every list's rows. */
  row: `group/row flex items-center w-full ${radius.button} ${text.secondary} transition-colors`,
  rowActive: item.active,
  item: 'touch-pan-y select-none flex flex-1 min-w-0 items-center gap-2.5 h-8 px-2.5 text-left text-sm cursor-grab',
  itemPinnable: 'touch-pan-y select-none flex flex-1 min-w-0 items-center gap-2.5 h-8 pl-2.5 pr-1 text-left text-sm cursor-grab',
  itemIcon: 'shrink-0 w-[1.125rem] h-[1.125rem] flex items-center justify-center text-stone-500',
  itemLabel: 'flex-1 truncate',
  itemTag: 'shrink-0 max-w-[8rem] truncate text-[0.6875rem] text-stone-500',
  /** Cards, two to a row: a picture of what each adds, its label and its tag under it. */
  cards: 'grid grid-cols-2 gap-1.5',
  card: `group/card relative ${radius.card} bg-field transition-shadow`,
  cardIdle: 'ring-1 ring-black/[0.10]',
  /** The card under the pointer or the keys: the accent's ring and halo, as a focused field wears them. */
  cardActive: 'ring-[1.5px] ring-accent shadow-[0_0_0_4px_rgba(107,85,200,0.16)]',
  cardPick: 'touch-pan-y select-none flex flex-col gap-1 w-full p-1.5 pb-2 text-left cursor-grab',
  cardPicture: `flex items-center justify-center h-[4.5rem] ${radius.button} bg-white ring-1 ring-inset ring-black/[0.06]
                overflow-hidden text-stone-500`,
  cardImage: 'max-w-full max-h-full object-contain p-1.5 pointer-events-none',
  cardLabel: `px-0.5 pt-0.5 text-[0.8125rem] font-medium leading-tight ${text.primary} truncate`,
  cardTag: 'px-0.5 text-[0.6875rem] text-stone-500 truncate',
  cardPin: `absolute top-2.5 right-2.5 inline-flex items-center justify-center size-6 ${radius.button} bg-field ring-1 ring-black/[0.10]
            text-stone-500 opacity-0 group-hover/card:opacity-100 group-data-[active=true]/card:opacity-100 focus-visible:opacity-100
            hover:text-stone-900 cursor-pointer`,
  cardPinOn: `absolute top-2.5 right-2.5 inline-flex items-center justify-center size-6 ${radius.button} bg-field ring-1 ring-black/[0.10]
              text-accent cursor-pointer`,

  /** Shown on the row under the pointer or the keys; always, in the accent, once pinned. */
  pin: `inline-flex items-center justify-center size-6 shrink-0 mr-1 ${radius.button} text-stone-500 opacity-0
        group-hover/row:opacity-100 group-data-[active=true]/row:opacity-100 focus-visible:opacity-100
        hover:bg-black/[0.06] cursor-pointer`,
  pinOn: `inline-flex items-center justify-center size-6 shrink-0 mr-1 ${radius.button} text-accent
          hover:bg-black/[0.06] cursor-pointer`,

  /** The style menu's stack of rows; each row's heading names what it styles. */
  swatchSections: 'p-1.5 flex flex-col gap-0.5',

  /** One row of chips; each chip's tooltip names its swatch. */
  swatchGrid: 'flex gap-1',
  swatchItem: `flex items-center justify-center p-1 ${radius.button}
               hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-pointer`,
  swatchItemActive: 'bg-black/[0.08]',
  /** The value that is set, as opposed to the one under the pointer: it has a ring, which the hover tint lacks. */
  swatchItemPressed: 'bg-black/[0.08] ring-2 ring-inset ring-stone-500/70',
  swatchChip: 'w-6 h-6 rounded-md border-2',
  /** A toggle's glyph, sized to sit in the same 24px square a chip fills. */
  swatchGlyph: 'w-6 h-6 flex items-center justify-center text-lg text-stone-600',
} as const;

