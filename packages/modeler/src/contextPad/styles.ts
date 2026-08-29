/**
 * The context pad's look, measured off the reference (ux-spec §4).
 *
 * diagram-js's `.djs-context-pad.open` is a 72px absolutely-positioned box whose
 * 22x22 entries flow inline and therefore wrap three to a row; each entry is a
 * transparent chip with a 3px radius that tints to `rgba(0,0,0,0.05)` on hover, in
 * `text-stone-700` going to `text-stone-900`, with `cursor: default` — NOT a pointer
 * — and a 120ms colour transition. Those are the numbers, so those are the classes.
 *
 * The pad deliberately wears NO panel: the reference floats bare glyphs over the
 * diagram (`edge-videos/preview/frame_05`), and a card behind them would read as a
 * second, heavier affordance next to the palette.
 *
 * z-order: palette 210 < context pad 215 < palette flyouts 300 < popover 320 — the
 * slot the selection toolbar it replaces used to occupy.
 */

import { tooltip as tooltipMaterial } from '@modeler/ui/styles';

export const contextPad = {
  /** 72px wide, entries inline → three per row. Positioned by `transform`. */
  root: 'fixed z-[215] left-0 top-0 w-[72px] leading-none select-none',

  entry: `inline-flex items-center justify-center align-middle w-[22px] h-[22px] mr-[2px] mb-[2px]
          rounded-[3px] bg-transparent text-stone-700 cursor-default
          hover:bg-black/[0.05] hover:text-stone-900
          disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-700
          transition-colors duration-[120ms] ease-linear`,

  /** The connect entry is dragged out of the pad, so it says so. */
  entryDraggable: 'cursor-crosshair',

  entryIcon: 'text-[16px]',

  /**
   * Dark tooltip, hung down-and-right of the POINTER — the placement every
   * reference frame shows (`edge-videos/preview/frame_04`, `frame_05`, `frame_08`),
   * because the reference's tooltips are the browser's own `title` bubbles and
   * those follow the cursor rather than the element.
   */
  tooltip: `pointer-events-none fixed z-[216] px-2 py-1 whitespace-nowrap
            ${tooltipMaterial} text-xs`,
} as const;
