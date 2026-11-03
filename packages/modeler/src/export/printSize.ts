/**
 * The size a TIFF prints at: its width on paper and its dots per inch. A unit of the diagram is a fixed length on
 * paper, so the shapes of a figure keep a size a reader can read: 0.2 mm a unit, a 36-unit event 7.2 mm across.
 */
export type PrintSize = { widthMm: number; dpi: number };

export const MM_PER_UNIT = 0.2;
export const DEFAULT_DPI = 300;

/** The width on paper of a drawing `units` wide, to a tenth of a millimetre. */
export const widthOnPaper = (units: number): number => Math.round(units * MM_PER_UNIT * 10) / 10;

/** The pixels a width on paper takes at `dpi`. */
export const pixelsAcross = (widthMm: number, dpi: number): number => Math.max(1, Math.round((widthMm / 25.4) * dpi));

/** The print size of the TIFF the canvas was opened from, so a save writes it back at its own size; none after another open. */
let opened: PrintSize | undefined;

export function rememberOpenedPrintSize(size: PrintSize | undefined): void {
  opened = size;
}

export const openedPrintSize = (): PrintSize | undefined => opened;
