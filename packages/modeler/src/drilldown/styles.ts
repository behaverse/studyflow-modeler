/**
 * The sub-process breadcrumb's look: a panel in the middle of the nav bar's row, the same as its bars, with ~14px
 * semibold text and muted `›` separators.
 *
 * The two crumb kinds differ at rest as well as under the pointer. An ancestor, the only clickable thing in the
 * bar, is the drill-down blue darkened to 38% lightness (14px text needs 4.5:1). The scope you are in is bold
 * near-black. Hover darkens the blue and puts a light gray chip behind it.
 *
 * z-order: the nav bar's (50), under the palette, the context pad and every menu, so anything that overlaps it is
 * drawn above it.
 */

import { material, radius, text } from '@modeler/ui/styles';

export const breadcrumbs = {
  /** Placed by the nav bar, whose row takes no clicks, so the pill takes its own. */
  root: `pointer-events-auto flex items-center gap-1 h-10 px-1.5 ${material.panel}
         text-sm leading-none select-none`,

  /** An ancestor: clickable, and blue at rest to show it. */
  crumb: `px-2 py-1.5 ${radius.button} font-semibold cursor-pointer
          text-[hsl(205,100%,38%)] hover:text-stone-900
          hover:bg-black/[0.05] transition-colors duration-[120ms] ease-linear`,

  /** The plane you are already looking at: the trail's end, so it is not a button. */
  crumbCurrent: `px-2 py-1.5 font-semibold ${text.primary}`,

  separator: `px-0.5 ${text.muted}`,
} as const;
