/**
 * The context pad's look: 28px entries with 18px glyphs on a small chrome chip, with the material, hairline and
 * shadow of the palette, so the two read as one family of floating controls. Entries wrap three to a row, and the
 * delete entry turns red on hover.
 *
 * z-order: palette 210 < context pad 215 < palette flyouts 300 < popover 320.
 */

import { border, radius, shadow, surface, tooltip as tooltipMaterial } from '@modeler/ui/styles';

export const contextPad = {
  /** 3 × 28px entries + 2px gaps + 4px padding + 1px borders. Positioned by `transform`. */
  root: `fixed z-[215] left-0 top-0 w-[6.125rem] select-none
         flex flex-wrap gap-0.5 p-1
         ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}`,

  entry: `flex items-center justify-center w-7 h-7 rounded-lg
          text-stone-600 cursor-pointer
          hover:bg-black/[0.05] hover:text-stone-900
          active:bg-black/[0.08]
          disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-600
          transition-colors duration-[120ms] ease-linear`,

  /** The trash: destructive, so it turns red under the pointer.
      The `!` outranks the base entry's hover colour, which shares specificity. */
  entryDanger: 'hover:bg-red-500/10 hover:text-red-600! active:bg-red-500/15',

  /** The connect entry is dragged out of the pad, so its cursor is a crosshair. */
  entryDraggable: 'cursor-crosshair',

  entryIcon: 'text-lg',

  /** Dark tooltip, hung down-and-right of the pointer, the way the browser's own `title` bubbles follow the cursor. */
  tooltip: `pointer-events-none fixed z-[216] px-2 py-1 whitespace-nowrap
            ${tooltipMaterial} text-xs`,
} as const;
