import { useMemo, useState } from 'react';
import { defaultPrintSize, figureSize } from '@modeler/export/commands';
import { pixelsAcross, type PrintSize } from '@modeler/export/printSize';
import { saveDialog as s } from '@modeler/export/styles';
import type { Editor } from '@modeler/editor/port';

/** What a dialog asks of a TIFF: its size on paper, as typed over what the figure is offered. */
export type PrintSizeState = {
  /** The figure's size in the diagram's units. */
  figure?: { width: number; height: number };
  /** The fields as typed, strings until read. */
  fields?: { over: PrintSize; widthMm: string; dpi: string };
  /** What the fields say, to write a TIFF at. */
  print?: PrintSize;
  /** Whether what they say can be written. */
  printable: boolean;
  /** The pixels the TIFF would have. */
  pixels?: { width: number; height: number };
  setTyped: (fields: { over: PrintSize; widthMm: string; dpi: string }) => void;
};

/**
 * A TIFF is asked its size on paper: the figure's own width at the modeler's unit, at 300 dpi, unless typed over.
 * What was typed holds for the size it was typed over, so each opening (`active` again) offers the size afresh.
 */
export function usePrintSize(modeler: Editor, active: boolean): PrintSizeState {
  const figure = useMemo(() => (active ? figureSize(modeler) : undefined), [active, modeler]);
  const offered = useMemo(() => (figure ? defaultPrintSize(modeler, figure) : undefined), [figure, modeler]);
  const [typed, setTyped] = useState<PrintSizeState['fields']>();
  const fields = typed?.over === offered ? typed : offered && { over: offered, widthMm: String(offered.widthMm), dpi: String(offered.dpi) };
  const print = fields && { widthMm: Number(fields.widthMm), dpi: Number(fields.dpi) };
  const printable = !print || (print.widthMm > 0 && print.dpi > 0);
  const pixels = figure && print && printable
    ? { width: pixelsAcross(print.widthMm, print.dpi), height: Math.max(1, Math.round((pixelsAcross(print.widthMm, print.dpi) * figure.height) / figure.width)) }
    : undefined;
  return { figure, fields, print, printable, pixels, setTyped };
}

/** The width on paper and the dots per inch, and the pixels they make; nothing until the size is known. */
export function PrintSizeFields({ size }: { size: PrintSizeState }) {
  const { figure, fields, pixels, setTyped } = size;
  if (!fields) return null;
  return (
    <div className={s.inline}>
      <input
        id="export-print-width"
        type="number"
        min="1"
        step="0.1"
        inputMode="decimal"
        aria-label="Width in mm"
        data-testid="export-print-width"
        data-units={figure?.width}
        value={fields.widthMm}
        onChange={(e) => setTyped({ ...fields, widthMm: e.target.value })}
        className={s.numberField}
      />
      <span>mm wide, at</span>
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        aria-label="Dots per inch"
        data-testid="export-print-dpi"
        value={fields.dpi}
        onChange={(e) => setTyped({ ...fields, dpi: e.target.value })}
        className={s.numberField}
      />
      <span>dpi</span>
      {pixels && <span className="text-stone-500" data-testid="export-print-pixels">{pixels.width} × {pixels.height} px</span>}
    </div>
  );
}
