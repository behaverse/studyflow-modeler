/**
 * The sub-process breadcrumb's look, measured off `edge-videos/sub/frame_04`.
 *
 * A single floating pill bar, horizontally centred over the canvas and 12px down
 * from its top edge: a light chrome surface, fully rounded ends, a soft drop shadow,
 * and ~14px semibold text. Separators are muted `›` chevrons.
 *
 * The two crumb kinds must be told apart AT REST, not only under the pointer
 * (`sub/frame_02`): an ancestor is drawn in the drill-down blue — the same hue as
 * the badge that brought you here (`canvas/view/plane.ts` `BADGE_FILL`) — while the
 * plane you are ON is bold near-black. Styling both alike and relying on the hover
 * chip alone makes the only clickable thing in the bar invisible until it is already
 * found. Hover then does what `sub/frame_04` shows: the blue goes dark and a light
 * gray chip appears behind it.
 *
 * bpmn-js's own breadcrumb CSS went with `assets/css/app.css` in P6b, so this is
 * built from the app's own surface tokens rather than restored from diagram-js.
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
         text-[14px] leading-none select-none`,

  /** An ancestor: clickable, and it says so in blue before it is ever hovered. */
  crumb: `px-2 py-1 rounded-full font-semibold cursor-pointer
          text-[hsl(205,100%,42%)] hover:text-stone-900
          hover:bg-black/[0.06] transition-colors duration-[120ms] ease-linear`,

  /** The plane you are already looking at — the trail's end, so it is not a button. */
  crumbCurrent: `px-2 py-1 font-semibold ${text.primary}`,

  separator: `px-0.5 ${text.muted}`,
} as const;
