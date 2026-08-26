/**
 * The studyflow element palette — six colours, one definition.
 *
 * These started life inline in `contextPad/ColorPickerProvider.ts` (the bpmn-js
 * `color-picker` popup provider). P6b §3B gives the canvas backend its own React
 * swatch popover, and the two must not drift, so the list moved here and both
 * render from it. The provider keeps its DI shape and its `injector` dispatch;
 * only the literal array left.
 *
 * `model/color.ts::normalizeColor` in the canvas accepts `#rgb`, `#rrggbb` and
 * `rgb(r,g,b)` and THROWS on anything else — never introduce a CSS colour name
 * here. `undefined` is the "clear it" value on both backends
 * (`SetColorHandler` and `applyColors` both read falsy as "remove").
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

/** What "Default" looks like in a swatch: the stock BPMN shape colours. */
export const DEFAULT_FILL = 'white';
export const DEFAULT_STROKE = 'rgb(34, 36, 42)';
