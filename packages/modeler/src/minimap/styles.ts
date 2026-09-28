/**
 * The minimap's look: a small card of the app's chrome in the canvas's bottom-left corner, just right of the palette
 * and under its flyouts (the palette is 210); the region the canvas shows is marked in the drill-down blue.
 */

import { border, radius, shadow, surface } from '@modeler/ui/styles';

export const minimap = {
  root: `fixed bottom-2 left-[3.75rem] z-[205] hidden md:block w-[200px] h-[130px] overflow-hidden
         ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}`,
} as const;

/**
 * The map's own stylesheet, inside its shadow root where the page's does not reach: its lines keep their width on
 * screen, or it would draw them a tenth as thick.
 */
export const MAP_CSS = `
div { width: 100%; height: 100%; }
svg { cursor: pointer; }
svg * { vector-effect: non-scaling-stroke; }
`;

/** The region the canvas shows, as the map draws it: a thin frame at any zoom, lightly filled. */
export const VIEW_MARK = {
  fill: 'hsl(205,100%,45%)',
  'fill-opacity': '0.08',
  stroke: 'hsl(205,100%,45%)',
  'stroke-width': '1.5',
} as const;
