/**
 * The context pad's look.
 *
 * Bigger and more legible than the diagram-js reference: 28px entries with 18px
 * glyphs on a small chrome chip — the same material, hairline and shadow the
 * palette wears, so the two read as one family of floating controls instead of
 * bare glyphs lost over the diagram. Entries wrap three to a row; the delete
 * entry tints red on hover so the destructive action reads before the click.
 *
 * z-order: palette 210 < context pad 215 < palette flyouts 300 < popover 320 — the
 * slot the selection toolbar it replaces used to occupy.
 */

import { border, radius, shadow, surface, tooltip as tooltipMaterial } from '@modeler/ui/styles';

export const contextPad = {
  /** 3 × 28px entries + 2px gaps + 4px padding + 1px borders. Positioned by `transform`. */
  root: `fixed z-[215] left-0 top-0 w-[98px] select-none
         flex flex-wrap gap-0.5 p-1
         ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}`,

  entry: `flex items-center justify-center w-7 h-7 rounded-lg
          text-stone-600 cursor-pointer
          hover:bg-black/[0.05] hover:text-stone-900
          active:bg-black/[0.08]
          disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-600
          transition-colors duration-[120ms] ease-linear`,

  /** The trash: destructive, so it wears red at rest and deepens on hover.
      The `!` outranks the base entry's stone colours, which share specificity. */
  entryDanger: 'text-red-500! hover:bg-red-500/10 hover:text-red-600! active:bg-red-500/15',

  /** The connect entry is dragged out of the pad, so it says so. */
  entryDraggable: 'cursor-crosshair',

  entryIcon: 'text-[18px]',

  /**
   * Dark tooltip, hung down-and-right of the POINTER — the placement every
   * reference frame shows (`edge-videos/preview/frame_04`, `frame_05`, `frame_08`),
   * because the reference's tooltips are the browser's own `title` bubbles and
   * those follow the cursor rather than the element.
   */
  tooltip: `pointer-events-none fixed z-[216] px-2 py-1 whitespace-nowrap
            ${tooltipMaterial} text-xs`,
} as const;
