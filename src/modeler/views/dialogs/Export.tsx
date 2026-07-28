/**
 * The one dialog a diagram leaves the app through.
 *
 * Choosing between the native `.studyflow` file and every other output is a
 * choice of format, not of menu — so there is no separate "save" path — and
 * the formats that can carry embedded payloads offer those as options right
 * where the format is picked, rather than burying them in settings.
 */
import { useEffect, useState } from 'react';
import { Button, Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useModeler } from '@/modeler/views/useModeler';
import { useDiagramName } from '@/modeler/views/navbar/useDiagramName';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { ToggleControl } from '@/modeler/views/settings/sections/controls';
import { dialog as d, exportDialog as s } from '@/modeler/infra/styles';
import {
  DEFAULT_EMBED_OPTIONS,
  EMBED_OPTIONS,
  EXPORT_FORMAT_GROUPS,
  exportFilename,
  getExportFormat,
  type EmbedOptionId,
  type EmbedOptions,
  type ExportFormatId,
} from '@/modeler/models/exporters/formats';
import { ICONS } from '@/icons';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function ExportDialog({ isOpen, onClose }: Props) {
  const modeler = useModeler();
  const { diagramName } = useDiagramName(modeler);
  const [formatId, setFormatId] = useState<ExportFormatId>('studyflow');
  const [embed, setEmbed] = useState<EmbedOptions>(DEFAULT_EMBED_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setError(null);
  }, [isOpen]);

  const format = getExportFormat(formatId);
  const filename = exportFilename(diagramName, format);

  const toggleEmbed = (id: EmbedOptionId, on: boolean) =>
    setEmbed((current) => ({ ...current, [id]: on }));

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await executeCommand(modeler, { type: 'export-diagram', format: formatId, embed });
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel transition className={`${d.panelMd} ${d.panel}`} data-testid="export-dialog">
            <DialogTitle as="h3" className={`${d.title} pb-3`}>
              Export
              <span className={d.closeButton} onClick={onClose}>
                <i className={ICONS.close}></i>
              </span>
            </DialogTitle>
            <p className={`${d.body} pb-4`}>
              Downloads to your browser's Downloads folder.
            </p>

            <div className={s.body}>
              {EXPORT_FORMAT_GROUPS.map(([group, formats]) => (
                <div key={group}>
                  <div className={s.groupLabel}>{group}</div>
                  <div className={s.group}>
                    {formats.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        data-testid={`export-format-${candidate.id}`}
                        aria-pressed={candidate.id === formatId}
                        onClick={() => setFormatId(candidate.id)}
                        className={`${s.format} ${candidate.id === formatId ? s.formatSelected : s.formatIdle}`}
                      >
                        <i className={`${candidate.icon} ${s.formatIcon}`}></i>
                        <span className={s.formatText}>
                          <span className={s.formatLabel}>
                            {candidate.label}
                            <span className={s.formatExtension}>{candidate.extension}</span>
                          </span>
                          <span className={s.formatDescription}>{candidate.description}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
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
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
