import { useState } from 'react';
import { Button } from '@headlessui/react';
import { Modal } from '@modeler/ui/Modal';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { useDiagramName } from '@modeler/navBar/useDiagramName';
import { executeCommand } from '@modeler/commandBus';
import { ToggleControl } from '@modeler/settings/controls';
import { dialog as d, text, radius } from '@modeler/ui/styles';
import {
  DEFAULT_EMBED_OPTIONS,
  EMBED_OPTIONS,
  EXPORT_FORMAT_GROUPS,
  exportFilename,
  getExportFormat,
  type EmbedOptionId,
  type EmbedOptions,
  type ExportFormatId,
} from '@modeler/export/formats';
import { ICONS } from '@modeler/icons';

const s = {
  formatRow: 'flex items-center gap-3',
  formatLabel: `text-sm font-medium ${text.secondary} shrink-0`,
  selectWrapper: 'relative flex-1 min-w-0',
  select: `appearance-none w-full px-2.5 py-1.5 pr-8 ${radius.field}
           border border-black/[0.08] bg-cream-100 text-sm text-stone-900
           focus:outline-2 focus:-outline-offset-2 focus:outline-[hsl(205,100%,45%)] cursor-pointer`,
  selectChevron: `${ICONS.caretDown} pointer-events-none absolute top-2.5 right-2.5 text-stone-500 text-xs`,

  options: 'mt-4 pt-4 border-t border-black/[0.06] space-y-3',
  optionsLabel: 'text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-stone-500',
  option: 'flex items-start gap-3',
  optionText: 'min-w-0 flex-1',
  optionLabel: `text-sm font-medium ${text.secondary}`,
  optionDescription: 'text-xs leading-snug text-stone-500 mt-0.5',

  footer: 'mt-5 pt-4 border-t border-black/[0.06] flex items-center justify-between gap-4',
  filename: 'font-mono text-xs text-stone-500 truncate',
  error: 'text-xs text-red-500 mt-2',
} as const;

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function ExportDialog({ isOpen, onClose }: Props) {
  const modeler = useRequiredModeler();
  const { diagramName } = useDiagramName(modeler);
  const [formatId, setFormatId] = useState<ExportFormatId>('studyflow');
  const [embed, setEmbed] = useState<EmbedOptions>(DEFAULT_EMBED_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const format = getExportFormat(formatId);
  const filename = exportFilename(diagramName, format);

  const toggleEmbed = (id: EmbedOptionId, on: boolean) =>
    setEmbed((current) => ({ ...current, [id]: on }));

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await executeCommand(modeler, { type: 'ExportDiagram', format: formatId, embed });
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Export failed. Try a different format, or reload the page.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export"
      size="sm"
      testId="export-dialog"
    >

            <div className={s.formatRow}>
              <label htmlFor="export-format-select" className={s.formatLabel}>Format</label>
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

            {format.embeddable && (
              <div className={s.options} data-testid="export-embed-options">
                <div className={s.optionsLabel}>Embed in the {format.label}</div>
                {EMBED_OPTIONS.map((option) => (
                  <div key={option.id} className={s.option}>
                    <div className={s.optionText}>
                      <div className={s.optionLabel}>{option.label}</div>
                      <p className={s.optionDescription}>{option.description}</p>
                    </div>
                    <ToggleControl
                      label={`Embed ${option.label}`}
                      checked={embed[option.id]}
                      onChange={(on) => toggleEmbed(option.id, on)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className={s.footer}>
              <span className={s.filename} data-testid="export-filename">{filename}</span>
              <Button
                type="button"
                onClick={runExport}
                disabled={busy}
                data-testid="export-submit"
                className={`inline-flex items-center gap-2 shrink-0 ${d.primaryBtn} disabled:opacity-50`}
              >
                <i className={ICONS.download}></i>
                {busy ? 'Exporting...' : 'Export'}
              </Button>
            </div>
            {error && <p className={s.error}>{error}</p>}
    </Modal>
  );
}
