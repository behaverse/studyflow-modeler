import { useState } from 'react';
import { Button } from '@headlessui/react';
import { Modal } from '@modeler/ui/Modal';
import { useModeler } from '@modeler/app/useModeler';
import { useDiagramName } from '@modeler/navBar/useDiagramName';
import { executeCommand } from '@modeler/commandBus';
import { supportsFileSystemAccess } from '@modeler/diagram/fileHandle';
import {
  EXPORT_FORMAT_GROUPS,
  exportFilename,
  getExportFormat,
  type ExportFormatId,
} from '@modeler/diagram/formats';
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
  const [formatId, setFormatId] = useState<ExportFormatId>('studyflow');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same destination, two mechanisms: the browser either lets the user place the file or it does not.
  const localAction = canSaveToFile ? 'Save' : 'Download';
  const localIcon = canSaveToFile ? ICONS.save : ICONS.download;
  const localHint = canSaveToFile
    ? 'Choose where it goes; edits keep saving there'
    : 'This browser can only put files in the downloads folder';

  const format = getExportFormat(formatId);
  const filename = exportFilename(diagramName, format);
  // A skill's destination asks what it needs and sends the study itself.
  const Panel = SKILL_SAVE_DESTINATIONS.find((option) => option.id === destination)?.Panel;

  async function runLocal() {
    setBusy(true);
    setError(null);
    try {
      // `SaveDiagram` picks the mechanism: a file the user places where the browser has a picker,
      // and a download where it does not. A diagram format also links, so later saves go back to it.
      const outcome = await executeCommand(modeler, { type: 'SaveDiagram', saveAs: true, format: formatId });
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

          <div className={s.footer}>
            <span className={s.filename} data-testid="export-filename">{filename}</span>
            <Button type="button" onClick={runLocal} disabled={busy} data-testid="save-submit" className={s.primaryBtn}>
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
