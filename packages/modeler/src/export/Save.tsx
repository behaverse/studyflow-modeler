import { useMemo, useState } from 'react';
import { Button } from '@headlessui/react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { useDiagramName } from '@modeler/navBar/useDiagramName';
import { executeCommand } from '@modeler/commandBus';
import { supportsFileSystemAccess } from '@modeler/diagram/fileHandle';
import { defaultSaveFormat, saveFilename } from '@modeler/diagram/save';
import {
  EXPORT_FORMAT_GROUPS,
  getExportFormat,
  type ExportFormatId,
} from '@modeler/diagram/formats';
import { defaultPrintSize, figureSize } from '@modeler/export/commands';
import { pixelsAcross, type PrintSize } from '@modeler/export/printSize';
import { saveDialog as s } from '@modeler/export/styles';
import { SKILL_SAVE_DESTINATIONS } from '@modeler/skillModules';
import { ICONS } from '@modeler/icons';

/**
 * Where the diagram is going: this machine, or a place a skill sends it (a server it publishes to). How it lands
 * locally — a file the user places, or a download — is the browser's business, not a question worth asking.
 */
const DESTINATIONS = [
  { id: 'local', label: 'Local', icon: ICONS.save, hint: '' },
  ...SKILL_SAVE_DESTINATIONS,
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function SaveDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const { diagramName } = useDiagramName(modeler);
  // No picker means no choosing where the file lands, so a download is the only local destination.
  const canSaveToFile = supportsFileSystemAccess();
  const [destination, setDestination] = useState('local');
  const [formatId, setFormatId] = useState<ExportFormatId>(() => defaultSaveFormat().id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same destination, two mechanisms: the browser either lets the user place the file or it does not.
  const localAction = canSaveToFile ? 'Save' : 'Download';
  const localIcon = canSaveToFile ? ICONS.save : ICONS.download;
  const localHint = canSaveToFile
    ? 'Choose where it goes; edits keep saving there'
    : 'This browser can only put files in the downloads folder';

  const format = getExportFormat(formatId);
  const filename = saveFilename(diagramName, format);

  // A TIFF is asked its size on paper: the figure's own width at the modeler's unit, at 300 dpi, unless typed over.
  // What was typed holds for the size it was typed over, so each opening offers the size afresh.
  const figure = useMemo(() => (isOpen && formatId === 'tif' ? figureSize(modeler) : undefined), [isOpen, formatId, modeler]);
  const offered = useMemo(() => (figure ? defaultPrintSize(modeler, figure) : undefined), [figure, modeler]);
  const [typed, setTyped] = useState<{ over: PrintSize; widthMm: string; dpi: string } | undefined>();
  const fields = typed?.over === offered ? typed : offered && { over: offered, widthMm: String(offered.widthMm), dpi: String(offered.dpi) };
  const print: PrintSize | undefined = fields && { widthMm: Number(fields.widthMm), dpi: Number(fields.dpi) };
  const printable = !print || (print.widthMm > 0 && print.dpi > 0);
  const pixels = figure && print && printable
    ? { width: pixelsAcross(print.widthMm, print.dpi), height: Math.max(1, Math.round((pixelsAcross(print.widthMm, print.dpi) * figure.height) / figure.width)) }
    : undefined;
  // A skill's destination asks what it needs and sends the study itself.
  const Panel = SKILL_SAVE_DESTINATIONS.find((option) => option.id === destination)?.Panel;

  async function runLocal() {
    setBusy(true);
    setError(null);
    try {
      // `SaveDiagram` picks the mechanism: a file the user places where the browser has a picker,
      // and a download where it does not. A diagram format also links, so later saves go back to it.
      const outcome = await executeCommand(modeler, { type: 'SaveDiagram', saveAs: true, format: formatId, print: formatId === 'tif' ? print : undefined });
      // A closed picker leaves the dialog up, so the user is not sent back through the menu.
      if (outcome !== 'skipped') onClose();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Saving failed. Try a different format, or reload the page.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Save" size="sm" testId="save-dialog">
      <div className={s.row}>
        <span className={s.rowLabel}>To</span>
        <div className={s.segmented} role="group" aria-label="Destination">
          {DESTINATIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid={`save-to-${option.id}`}
              aria-pressed={destination === option.id}
              title={option.id === 'local' ? localHint : option.hint}
              onClick={() => { setDestination(option.id); setError(null); }}
              className={`${s.segment} ${destination === option.id ? s.segmentActive : s.segmentIdle}`}
            >
              <i className={option.icon}></i>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {Panel ? <Panel onClose={onClose} /> : (
        <>
          <div className={`${s.row} mt-3`}>
            <label htmlFor="export-format-select" className={s.rowLabel}>Format</label>
            <div className={s.selectWrapper}>
              <select
                id="export-format-select"
                data-testid="export-format"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value as ExportFormatId)}
                className={s.select}
              >
                {EXPORT_FORMAT_GROUPS.map(([group, formats]) => (
                  <optgroup key={group} label={group}>
                    {formats.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label} ({candidate.extension})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <i className={s.selectChevron} aria-hidden="true" />
            </div>
          </div>

          {formatId === 'tif' && fields && (
            <div className={`${s.row} mt-3`}>
              <label htmlFor="export-print-width" className={s.rowLabel}>Print</label>
              <div className={s.inline}>
                <input
                  id="export-print-width"
                  type="number"
                  min="1"
                  step="0.1"
                  inputMode="decimal"
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
            </div>
          )}

          <div className={s.footer}>
            <span className={s.filename} data-testid="export-filename">{filename}</span>
            <Button type="button" onClick={runLocal} disabled={busy || !printable} data-testid="save-submit" className={s.primaryBtn}>
              <i className={localIcon}></i>
              {busy ? 'Working...' : localAction}
            </Button>
          </div>
          {error && <p className={s.error}>{error}</p>}
        </>
      )}
    </Modal>
  );
}
