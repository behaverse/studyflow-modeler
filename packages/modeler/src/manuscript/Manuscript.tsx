import { useMemo, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { MANUSCRIPT_FORMATS } from '@modeler/diagram/formats';
import { PrintSizeFields, usePrintSize } from '@modeler/export/PrintSizeFields';
import { dropUnresolvedIcons, padSvg } from '@modeler/export/svgEmbedding';
import { dialog as d } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

type Props = { isOpen: boolean; onClose: () => void };

/**
 * The figure the canvas makes, as a paper prints it: the drawing, on its own page, with a margin
 * round it. Like the images in Save, each figure carries the study it shows, so a reader holding
 * only the figure can open it in the modeler, validate it and run it.
 */
export function ManuscriptDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The TIFF prints at a size the view asks; the other figures are a pixel a unit, or vectors.
  const size = usePrintSize(modeler, isOpen);

  // An `<img>`, not inlined markup: the figure carries its own ids, and this keeps them out of the page.
  // A data URL rather than an object URL: nothing to revoke, so nothing to get the lifetime wrong.
  const src = useMemo(() => (isOpen
    ? `data:image/svg+xml;utf8,${encodeURIComponent(padSvg(dropUnresolvedIcons(modeler.toSvg({ pastedImages: true }))))}`
    : undefined), [isOpen, modeler]);

  async function write(id: string) {
    setBusy(id);
    setError(null);
    try {
      await executeCommand(modeler, { type: 'ExportDiagram', format: id, print: size.print });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'The figure could not be written.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Manuscript View"
      size="lg"
      testId="manuscript-dialog"
    >
      {/* The figure is scaled to fit, not scrolled: the point of the view is seeing the whole page at once. */}
      <div className={`flex-1 min-h-0 flex items-center justify-center ${d.preview}`}>
        {src && <img src={src} alt="The diagram as a figure" className="max-h-[60vh] max-w-full object-contain" />}
      </div>
      <div className={`${d.footer} flex-wrap justify-between`}>
        <div className="flex items-center gap-2 text-sm text-stone-700">
          <label htmlFor="export-print-width" className="font-medium shrink-0">TIFF</label>
          <PrintSizeFields size={size} />
        </div>
        <div className="flex items-center gap-2">
          {MANUSCRIPT_FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              disabled={busy !== null || (format.id === 'figure-tif' && !size.printable)}
              onClick={() => void write(format.id)}
              data-testid={`manuscript-${format.id}`}
              // Four equal ways out, none the default: each a secondary button.
              className={d.secondaryBtn}
            >
              <i className={ICONS.download}></i>
              {busy === format.id ? 'Working...' : format.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className={`${d.error} mt-2`}>{error}</p>}
    </Modal>
  );
}
