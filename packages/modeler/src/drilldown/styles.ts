/**
 * The sub-process breadcrumb's look: one floating pill, centred over the canvas, with a
 * light chrome surface, rounded ends, a soft shadow, ~14px semibold text and muted `›`
 * separators.
 *
 * The two crumb kinds differ at rest, not only under the pointer: an ancestor, the only
 * clickable thing in the bar, is the drill-down blue darkened to 38% lightness (14px text
 * needs 4.5:1), and the scope you are in is bold near-black. Hover darkens the blue and
 * puts a light gray chip behind it.
 *
 * z-order: it sits with the rest of the floating canvas chrome, below the palette
 * flyouts (300) and the popover (320) and just under the context pad (215) — nothing
 * ever overlaps it, and a menu that does must win.
 */

import { radius, shadow, surface, text } from '@modeler/ui/styles';

export const breadcrumbs = {
  /** Positioned by the component from the canvas container's rect. */
  root: `fixed z-[214] -translate-x-1/2 flex items-center gap-1 px-3 py-1.5
         ${radius.pill} ${surface.chrome} ${shadow.panel} border border-black/[0.06]
         text-sm leading-none select-none`,

  /** An ancestor: clickable, and it says so in blue before it is ever hovered. */
  crumb: `px-2 py-1 rounded-full font-semibold cursor-pointer
          text-[hsl(205,100%,38%)] hover:text-stone-900
          hover:bg-black/[0.05] transition-colors duration-[120ms] ease-linear`,

  /** The plane you are already looking at — the trail's end, so it is not a button. */
  crumbCurrent: `px-2 py-1 font-semibold ${text.primary}`,

  separator: `px-0.5 ${text.muted}`,
} as const;
