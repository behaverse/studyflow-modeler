/**
 * The studyflow element palette: six colours, defined once.
 *
 * The `color-picker` popup's swatch grid and the inspector's colour fields render from this one list, so the two
 * cannot drift.
 *
 * `study/color.ts::normalizeColor` in the canvas accepts `#rgb`, `#rrggbb` and `rgb(r,g,b)` and throws on anything
 * else, so never put a CSS colour name here. `undefined` clears the colour (the canvas's `setColor` reads falsy as
 * "remove").
 */

export type ElementColor = {
  label: string;
  fill: string | undefined;
  stroke: string | undefined;
};

export const ELEMENT_COLORS: ElementColor[] = [
  { label: 'Default', fill: undefined, stroke: undefined },
  { label: 'Blue',    fill: '#DDE8FA', stroke: '#728CB9' },
  { label: 'Orange',  fill: '#FBE7CF', stroke: '#CE9D35' },
  { label: 'Green',   fill: '#D9E7D6', stroke: '#8CB26E' },
  { label: 'Red',     fill: '#F1D0CD', stroke: '#AC5A54' },
  { label: 'Purple',  fill: '#DFD5E6', stroke: '#9174A3' },
];

/** The canvas's stock ink, for text set black on a coloured element, whose text otherwise takes its stroke. */
export const BLACK_TEXT = '#1c1917';

/** The colours the "Default" swatch shows: the stock BPMN shape colours. */
export const DEFAULT_FILL = 'white';
export const DEFAULT_STROKE = 'rgb(34, 36, 42)';
