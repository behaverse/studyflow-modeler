import { useMemo, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { exportDiagramName } from '@modeler/diagram/name';
import { saveBlob } from '@modeler/export/commands';
import { reportingDocuments, type ReportingDocument } from '@modeler/skillModules';
import { dialog as d, radius } from '@modeler/ui/styles';
import { DialogHelp } from '@modeler/ui/DialogHelp';
import { ICONS } from '@modeler/icons';
import type { Editor } from '@modeler/editor/port';

type Props = { isOpen: boolean; onClose: () => void };

const chip = {
  base: `px-3 py-1 ${radius.pill} text-[12.5px] border transition-colors cursor-pointer`,
  idle: 'border-black/[0.06] text-stone-600 hover:bg-black/[0.04]',
  active: 'bg-stone-900 border-stone-900 text-cream-50',
};

/** What a document draws of the study, or why it could not: a skill's mistake is said here, not thrown at the app. */
function drawn(modeler: Editor, document: ReportingDocument): { svg: string } | { unavailable: string } {
  try {
    return document.draw(modeler);
  } catch (err) {
    console.error(`Reporting document ${document.id} could not be drawn:`, err);
    return { unavailable: `This document could not be drawn: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The documents reporting guidelines ask of a study, each drawn from the diagram as it stands by the skill that knows
 * the guideline: the view lists what the skills in use offer and shows the one picked. It reads the study and writes
 * nothing to it.
 */
export function ReportingDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const documents = useMemo(() => (isOpen ? reportingDocuments() : []), [isOpen]);
  const [picked, setPicked] = useState<string | undefined>();
  const current = documents.find((document) => document.id === picked) ?? documents[0];
  const figure = useMemo(() => (isOpen && current ? drawn(modeler, current) : undefined), [isOpen, current, modeler]);
  // An `<img>`, as the Manuscript view shows its figure: the picture keeps its own ids out of the page.
  const src = figure && 'svg' in figure ? `data:image/svg+xml;utf8,${encodeURIComponent(figure.svg)}` : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reporting Diagram View"
      size="lg"
      testId="reporting-dialog"
      help={<DialogHelp>
              A document a reporting guideline asks for, drawn from the diagram and the counts its last run left.
              Each guideline comes with an extension: switch one on or off in Settings, Extensions.
            </DialogHelp>}
    >
      {documents.length === 0 ? (
        <p className="text-sm text-stone-500 italic">
          No extension in use draws a reporting diagram. Switch one on in Settings, Extensions.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 pb-3" role="tablist" aria-label="Reporting documents">
            {documents.map((document) => (
              <button
                key={document.id}
                type="button"
                role="tab"
                aria-selected={document === current}
                data-testid={`reporting-${document.id}`}
                onClick={() => setPicked(document.id)}
                className={`${chip.base} ${document === current ? chip.active : chip.idle}`}
              >
                {document.guideline} · {document.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-stone-500 pb-3">{current.description}</p>
          <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center bg-white border border-black/[0.06] rounded-lg p-3">
            {src
              ? <img src={src} alt={`${current.guideline}: ${current.label}`} data-testid="reporting-figure" className="max-w-full" />
              : <p className="text-sm text-stone-500 italic self-center" data-testid="reporting-unavailable">{figure && 'unavailable' in figure ? figure.unavailable : ''}</p>}
          </div>
          <div className="mt-4 pt-4 border-t border-black/[0.06] flex justify-end">
            <button
              type="button"
              disabled={!figure || !('svg' in figure)}
              data-testid="reporting-download"
              onClick={() => {
                if (figure && 'svg' in figure) saveBlob(new Blob([figure.svg], { type: 'image/svg+xml;charset=utf-8' }), `${exportDiagramName(modeler)}.${current.id}.svg`);
              }}
              className={`inline-flex items-center gap-2 ${d.primaryBtn} disabled:opacity-50`}
            >
              <i className={ICONS.download}></i>
              SVG
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
