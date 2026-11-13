/**
 * The minimap's look: a small card of the app's chrome, with rings in the drill-down blue. Its host positions it.
 */

import { border, radius, shadow, surface } from '@modeler/ui/styles';

export const minimap = {
  root: `hidden md:block w-[200px] h-[130px] overflow-hidden ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}`,
} as const;

/**
 * The map's own stylesheet, inside its shadow root where the page's does not reach: its lines keep their width on
 * screen, or it would draw them a tenth as thick.
 */
export const MAP_CSS = `
div { width: 100%; height: 100%; }
svg * { vector-effect: non-scaling-stroke; }
`;

/** The ring round an element the map points at: a frame at any zoom, lightly filled. */
export const FOCUS_RING = {
  fill: 'hsl(205,100%,45%)',
  'fill-opacity': '0.15',
  stroke: 'hsl(205,100%,45%)',
  'stroke-width': '2',
} as const;
