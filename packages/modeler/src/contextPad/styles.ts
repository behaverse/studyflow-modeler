/**
 * The context pad's look: 28px entries with 18px glyphs on a small chrome chip, with the material, hairline and
 * shadow of the palette, so the two read as one family of floating controls. Entries wrap three to a row, and the
 * delete entry turns red on hover. A ring in the accent ties the pad to the selection it acts on, which wears the
 * same accent on the canvas, in the inspector and on the composer's chip.
 *
 * z-order: palette 210 < context pad 215 < palette flyouts 300 < popover 320.
 */

import { divider, material, space, tip } from '@modeler/ui/styles';

export const contextPad = {
  /** 3 × 28px entries + 2px gaps + 4px padding + 1px borders. Positioned by `transform`. */
  root: `fixed z-[215] left-0 top-0 w-[6.5rem] select-none
         flex flex-wrap gap-1 ${space.barInset} ${material.panel} ring-1 ring-accent/30`,

  /** The pad with the inline inspector under it (`inspector/InlineInspector.tsx`): its actions in a row, then the fields. */
  inline: `fixed z-[215] left-0 top-0 w-60 flex flex-col ${material.panel} ring-1 ring-accent/30`,
  inlineActions: `flex flex-wrap gap-1 ${space.barInset} select-none border-b ${divider.edge}`,

  entry: `flex items-center justify-center w-7 h-7 rounded-md
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
  tooltip: `pointer-events-none fixed z-[216] ${tip.label}`,
} as const;
