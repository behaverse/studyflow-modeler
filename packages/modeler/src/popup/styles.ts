import { divider, item, material, radius, sectionLabel, text } from '@modeler/ui/styles';
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

  header: `flex items-center gap-2 px-3 h-9 shrink-0 border-b ${divider.edge} ${sectionLabel}`,

  searchRow: `flex items-center gap-2 px-3 h-9 shrink-0 border-b ${divider.edge}`,
  searchIcon: `${ICONS.search} text-stone-500 text-xs shrink-0`,
  searchInput: `flex-1 min-w-0 bg-transparent text-sm ${text.primary} placeholder-stone-400 focus:outline-none`,

  list: 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-1.5',
  empty: 'text-sm text-stone-500 italic py-6 text-center',

  groupLabel: `${sectionLabel} px-2.5 pt-2 pb-1 first:pt-0.5`,

  item: `touch-pan-y select-none ${item.base} cursor-grab`,
  itemActive: item.active,
  itemIcon: 'shrink-0 w-[1.125rem] h-[1.125rem] flex items-center justify-center text-stone-500',
  itemLabel: 'flex-1 truncate',

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

