import { useMemo, useState } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { exportDiagramName } from '@modeler/diagram/name';
import { saveBlob } from '@modeler/export/commands';
import { reportingDocuments, type ReportingDocument } from '@modeler/skillModules';
import { choice, dialog as d } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';
import type { Editor } from '@modeler/editor/port';

type Props = { isOpen: boolean; onClose: () => void };

const chip = { base: choice.base, idle: choice.idle, active: choice.selected };

/** The document's drawing of the study, or the reason it has none. A skill's error is reported here instead of thrown at the app. */
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
    >
      {documents.length === 0 ? (
        <p className={d.empty}>
          No reporting guideline is on.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 mb-4" role="tablist" aria-label="Reporting documents">
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
          <p className={d.lead}>{current.description}</p>
          <div className={`flex-1 min-h-0 overflow-auto flex items-start justify-center ${d.preview}`}>
            {src
              ? <img src={src} alt={`${current.guideline}: ${current.label}`} data-testid="reporting-figure" className="max-w-full" />
              : <p className={`${d.empty} self-center`} data-testid="reporting-unavailable">{figure && 'unavailable' in figure ? figure.unavailable : ''}</p>}
          </div>
          <div className={`${d.footer} justify-end`}>
            <button
              type="button"
              disabled={!figure || !('svg' in figure)}
              data-testid="reporting-download"
              onClick={() => {
                if (figure && 'svg' in figure) saveBlob(new Blob([figure.svg], { type: 'image/svg+xml;charset=utf-8' }), `${exportDiagramName(modeler)}.${current.id}.svg`);
              }}
              className={d.primaryBtn}
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
