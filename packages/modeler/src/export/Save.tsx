import { useState, type FormEvent } from 'react';
import { Button, Description, Field, Input, Label } from '@headlessui/react';
import { Modal } from '@modeler/ui/Modal';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { useDiagramName } from '@modeler/navBar/useDiagramName';
import { executeCommand } from '@modeler/commandBus';
import { supportsFileSystemAccess } from '@modeler/diagram/fileHandle';
import { URLS } from '@modeler/constants';
import { dialog as d, text, radius } from '@modeler/ui/styles';
import {
  EXPORT_FORMAT_GROUPS,
  exportFilename,
  getExportFormat,
  type ExportFormatId,
} from '@modeler/export/formats';
import { ICONS } from '@modeler/icons';

const s = {
  row: 'flex items-center gap-3',
  rowLabel: `text-[13px] font-medium ${text.secondary} shrink-0 w-16`,
  selectWrapper: 'relative flex-1 min-w-0',
  select: `appearance-none w-full px-2.5 py-1.5 pr-8 ${radius.field}
           border border-black/[0.08] bg-cream-100 text-[13px] text-stone-900
           focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400 cursor-pointer`,
  selectChevron: `${ICONS.caretDown} pointer-events-none absolute top-2.5 right-2.5 text-stone-500 text-[12px]`,

  segmented: `flex-1 flex gap-1 p-1 ${radius.field} bg-cream-200`,
  segment: `flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 ${radius.field}
            text-[12.5px] font-medium transition-colors cursor-pointer`,
  segmentIdle: 'text-stone-600 hover:bg-black/[0.04]',
  segmentActive: 'bg-cream-50 text-stone-900 shadow-[0_1px_2px_rgba(0,0,0,0.06)]',

  options: 'mt-4 pt-4 border-t border-black/[0.06] space-y-3',
  optionsLabel: 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-500',
  option: 'flex items-start gap-3',
  optionText: 'min-w-0 flex-1',
  optionLabel: `text-[13px] font-medium ${text.secondary}`,
  optionDescription: 'text-[12px] leading-snug text-stone-500 mt-0.5',

  fields: 'mt-4 pt-4 border-t border-black/[0.06] space-y-4',
  footer: 'mt-5 pt-4 border-t border-black/[0.06] flex items-center justify-between gap-4',
  filename: 'font-mono text-[12px] text-stone-500 truncate',
  primaryBtn: `inline-flex items-center gap-2 shrink-0 ${d.primaryBtn} disabled:opacity-50`,
  error: 'text-[12px] text-red-500 mt-2',
  status: 'text-[12px] text-stone-600 mt-2',
} as const;

/**
 * Where the diagram is going: this machine, or the Behaverse server. How it lands locally — a file
 * the user places, or a download — is the browser's business, not a question worth asking.
 */
type Destination = 'local' | 'cloud';

const DESTINATIONS: Array<{ id: Destination; label: string; icon: string; hint: string }> = [
  { id: 'local', label: 'Local', icon: ICONS.save, hint: '' },
  { id: 'cloud', label: 'Cloud', icon: ICONS.broadcast, hint: 'Upload to the Behaverse server' },
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function SaveDialog({ isOpen, onClose }: Props) {
  const modeler = useRequiredModeler();
  const { diagramName } = useDiagramName(modeler);
  // No picker means no choosing where the file lands, so a download is the only local destination.
  const canSaveToFile = supportsFileSystemAccess();
  const [destination, setDestination] = useState<Destination>('local');
  const [formatId, setFormatId] = useState<ExportFormatId>('studyflow');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();

  // Same destination, two mechanisms: the browser either lets the user place the file or it does not.
  const localAction = canSaveToFile ? 'Save' : 'Download';
  const localIcon = canSaveToFile ? ICONS.save : ICONS.download;
  const localHint = canSaveToFile
    ? 'Choose where it goes; edits keep saving there'
    : 'This browser can only put files in the downloads folder';

  const format = getExportFormat(formatId);
  const filename = exportFilename(diagramName, format);
  const publishing = destination === 'cloud';

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

  async function runPublish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    setBusy(true);
    setError(null);
    setStatus('Publishing...');
    setPreviewUrl(undefined);
    try {
      const result = await executeCommand(modeler, {
        type: 'PublishDiagram',
        studyName: String(form.get('study_name') || ''),
        apiKey: String(form.get('api_key') || ''),
      });
      setStatus('Published. Open the preview to check it.');
      setPreviewUrl(result.previewUrl);
    } catch (err: any) {
      console.error(err);
      setStatus(null);
      setError(err?.message || 'Publishing failed. Check the study name and your connection, then retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Save" size="sm" testId="save-dialog">
      <form onSubmit={runPublish}>
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
                onClick={() => { setDestination(option.id); setError(null); setStatus(null); }}
                className={`${s.segment} ${destination === option.id ? s.segmentActive : s.segmentIdle}`}
              >
                <i className={option.icon}></i>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Publishing always sends the studyflow itself, so the format question does not apply. */}
        {!publishing && (
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
        )}

        {publishing && (
          <div className={s.fields}>
            <Field>
              <Label className={d.label}>Study name</Label>
              <Input name="study_name" className={d.input} placeholder="my-study" />
              <Description className={d.helpText}>Lower-case letters, numbers, and hyphens only.</Description>
            </Field>
            <Field>
              <Label className={d.label}>Behaverse API key</Label>
              <Input name="api_key" type="password" className={d.input} placeholder="Paste your key" />
              <Description className={d.helpText}>
                Sign in from Settings &gt; Account to get one, or see the{' '}
                <a className={d.bodyLink} href={URLS.apiDocs} target="_blank" rel="noreferrer">API docs</a>.
              </Description>
            </Field>
          </div>
        )}

        <div className={s.footer}>
          <span className={s.filename} data-testid="export-filename">
            {publishing ? 'Sent to the Behaverse server' : filename}
          </span>
          {previewUrl ? (
            <a href={previewUrl} target="_blank" rel="noreferrer" className={`shrink-0 ${d.previewBtn}`}>Preview</a>
          ) : (
            <Button
              type={publishing ? 'submit' : 'button'}
              onClick={publishing ? undefined : runLocal}
              disabled={busy}
              data-testid="save-submit"
              className={s.primaryBtn}
            >
              <i className={publishing ? ICONS.broadcast : localIcon}></i>
              {busy ? 'Working...' : publishing ? 'Publish' : localAction}
            </Button>
          )}
        </div>
        {status && <p className={s.status}>{status}</p>}
        {error && <p className={s.error}>{error}</p>}
      </form>
    </Modal>
  );
}
