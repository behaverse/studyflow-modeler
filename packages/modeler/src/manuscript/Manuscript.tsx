import { useMemo, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { MANUSCRIPT_FORMATS } from '@modeler/diagram/formats';
import { dropUnresolvedIcons, padSvg } from '@modeler/export/svgEmbedding';
import { dialog as d } from '@modeler/ui/styles';
import { DialogHelp } from '@modeler/ui/DialogHelp';
import { ICONS } from '@modeler/icons';

type Props = { isOpen: boolean; onClose: () => void };

/**
 * The figure the canvas makes, as a paper prints it: the drawing alone, on its own page, with a
 * margin round it. Unlike the images in Save, nothing here carries the studyflow: a figure is a
 * figure, and the `.studyflow.yaml` stays the file you reopen.
 */
export function ManuscriptDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // An `<img>`, not inlined markup: the figure carries its own ids, and this keeps them out of the page.
  // A data URL rather than an object URL: nothing to revoke, so nothing to get the lifetime wrong.
  const src = useMemo(() => (isOpen
    ? `data:image/svg+xml;utf8,${encodeURIComponent(padSvg(dropUnresolvedIcons(modeler.canvas.toSVG())))}`
    : undefined), [isOpen, modeler]);

  async function write(id: string) {
    setBusy(id);
    setError(null);
    try {
      await executeCommand(modeler, { type: 'ExportDiagram', format: id });
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
      help={<DialogHelp>
              The diagram as a manuscript figure. The editable SVG carries the draw.io file that redraws
              it, so a figure can be finished in draw.io; none of these carry the studyflow, which Save writes.
            </DialogHelp>}
    >
      {/* The figure is scaled to fit, not scrolled: the point of the view is seeing the whole page at once. */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-white/40 border border-black/[0.06] rounded-lg p-3">
        {src && <img src={src} alt="The diagram as a figure" className="max-h-[60vh] max-w-full object-contain" />}
      </div>
      <div className="mt-4 pt-4 border-t border-black/[0.06] flex items-center justify-end gap-2">
        {MANUSCRIPT_FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void write(format.id)}
            data-testid={`manuscript-${format.id}`}
            className={`inline-flex items-center gap-2 ${d.primaryBtn} disabled:opacity-50`}
          >
            <i className={ICONS.download}></i>
            {busy === format.id ? 'Working...' : format.label}
          </button>
        ))}
      </div>
      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </Modal>
  );
}
