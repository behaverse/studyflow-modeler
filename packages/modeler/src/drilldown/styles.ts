/**
 * The sub-process breadcrumb's look: a panel in the middle of the nav bar's row, the same as its bars, with ~14px
 * semibold text and muted `›` separators.
 *
 * The two crumb kinds differ at rest as well as under the pointer. An ancestor, the only clickable thing in the
 * bar, is muted ink; the scope you are in is near-black. Hover darkens an ancestor and puts a light chip behind
 * it. Blue is for focus alone.
 *
 * z-order: the nav bar's (50), under the palette, the context pad and every menu, so anything that overlaps it is
 * drawn above it.
 */

import { material, radius, space, text } from '@modeler/ui/styles';

export const breadcrumbs = {
  /** Placed by the nav bar, whose row takes no clicks, so the pill takes its own. */
  root: `pointer-events-auto flex items-center ${space.bar} ${material.panel}
         text-sm leading-none select-none`,

  /** An ancestor: clickable, and blue at rest to show it. */
  crumb: `inline-flex items-center h-7 px-2 ${radius.button} font-semibold cursor-pointer
          text-stone-600 hover:text-stone-900
          hover:bg-black/[0.05] transition-colors duration-[120ms] ease-linear`,

  /** The plane you are already looking at: the trail's end, so it is not a button. */
  crumbCurrent: `inline-flex items-center h-7 px-2 font-semibold ${text.primary}`,

  separator: `px-0.5 ${text.muted}`,
} as const;
