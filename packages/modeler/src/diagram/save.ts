/**
 * Saving: write the diagram back into the file it came from, in place, with no download.
 *
 * The first pick is the permission; everything after it is silent. Where the browser has no
 * picker at all, saving degrades to the export download and the user places the file themselves.
 */
import { notify } from '@modeler/app/noticeStore';
import {
  changedElsewhere,
  changedOnDisk,
  ensureWritePermission,
  getLink,
  linkFile,
  markBlocked,
  markConflict,
  markError,
  markSaved,
  markSaving,
  pickSaveTarget,
  readFile,
  supportsFileSystemAccess,
  writeToFile,
  type LinkedFile,
} from '@modeler/diagram/fileHandle';
import { exportDiagramName } from '@modeler/export/common';
import { encodeDiagram, runExportDiagram, stampProvenance } from '@modeler/export/commands';
import {
  autoSavable,
  carriesDiagram,
  exportFilename,
  getExportFormat,
  type ExportFormat,
  type ExportFormatId,
} from '@modeler/export/formats';
import type { Modeler } from '@modeler/bpmn/types';

export type SaveDiagramCommand = {
  type: 'SaveDiagram';
  /** Always opens the picker, then links whatever the user chose. The Export dialog's other half. */
  saveAs?: boolean;
  /** What to write. Defaults to the linked file's own format, and to studyflow when nothing is linked. */
  format?: ExportFormatId;
  /** The auto-save write-through: never prompts, never opens a picker, gives up quietly. */
  auto?: boolean;
};

export type SaveOutcome =
  /** Written into the linked file. */
  | 'saved'
  /** No picker in this browser, so it went to the downloads folder instead. */
  | 'downloaded'
  /** Nothing was written: cancelled, not permitted, or standing down from a conflict. */
  | 'skipped';

/** One place to say a write failed; returns the message so callers can also record it. */
function reportWriteFailure(name: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Could not write ${name}.`, err);
  notify('error', `Could not write ${name}: ${message}`);
  return message;
}

export async function runSaveDiagram(modeler: Modeler, command: SaveDiagramCommand): Promise<SaveOutcome> {
  const { file } = getLink();

  if (command.saveAs || !file) {
    // Auto-save never opens a picker: a dialog nobody asked for is worse than not saving.
    if (command.auto) return 'skipped';
    const format = command.format
      ? getExportFormat(command.format)
      : file?.format ?? getExportFormat('studyflow');
    return saveToNewFile(modeler, format);
  }

  return saveInPlace(modeler, file, command.auto === true);
}

async function saveToNewFile(modeler: Modeler, format: ExportFormat): Promise<SaveOutcome> {
  // No picker in this browser: the downloads folder is the only place a page may put a file.
  if (!supportsFileSystemAccess()) {
    await runExportDiagram(modeler, { type: 'ExportDiagram', format: format.id });
    return 'downloaded';
  }

  const handle = await pickSaveTarget(exportFilename(exportDiagramName(modeler), format), format);
  if (!handle) return 'skipped';

  // A derived document is written once and let go; only a format we can read back is worth linking.
  if (!carriesDiagram(format)) return writeOnce(modeler, handle, format);

  return saveInPlace(modeler, linkFile(handle, format), false);
}

/** Written where the user asked, then forgotten. Edits do not follow it. */
async function writeOnce(
  modeler: Modeler,
  handle: FileSystemFileHandle,
  format: ExportFormat,
): Promise<SaveOutcome> {
  try {
    await writeToFile(handle, await encodeDiagram(modeler, format));
    return 'saved';
  } catch (err) {
    // Deliberately not `markError`: a different file may be linked, and this is not it.
    reportWriteFailure(handle.name, err);
    return 'skipped';
  }
}

/** Set while a conflict stands, so a debounced auto-save reports it once rather than every tick. */
let reportedConflictFor: FileSystemFileHandle | undefined;

async function saveInPlace(modeler: Modeler, file: LinkedFile, auto: boolean): Promise<SaveOutcome> {
  // Rendering an image costs seconds, which is no way to spend a debounce tick; those files wait
  // for a save the user asked for, and the chip goes on saying there are unsaved edits until then.
  if (auto && !autoSavable(file.format)) return 'skipped';

  // Only an explicit save may ask: `requestPermission` outside a gesture is denied without a prompt.
  const permission = await ensureWritePermission(file.handle, { request: !auto });
  if (permission !== 'granted') {
    markBlocked();
    if (!auto) {
      notify('error', `The browser did not grant permission to write ${file.name}. Use "Export..." to choose the file again.`);
    }
    return 'skipped';
  }

  if (auto && changedOnDisk(file, await readFile(file.handle))) {
    markConflict(changedElsewhere(file.name));
    if (reportedConflictFor !== file.handle) {
      reportedConflictFor = file.handle;
      notify('warning', changedElsewhere(file.name));
    }
    return 'skipped';
  }

  markSaving();
  try {
    // Auto-save deliberately leaves no stamp. `stampTrailForExport` appends once per edit burst,
    // which at this cadence would turn the provenance trail into a keystroke log; an explicit
    // save, an export, or a publish is what records that a person changed this studyflow.
    if (!auto) stampProvenance(modeler, file.format);
    const payload = await encodeDiagram(modeler, file.format);
    markSaved(await writeToFile(file.handle, payload));
    reportedConflictFor = undefined;
    return 'saved';
  } catch (err) {
    markError(reportWriteFailure(file.name, err));
    return 'skipped';
  }
}
