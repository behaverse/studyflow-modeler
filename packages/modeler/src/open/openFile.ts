/**
 * What "opening a file" means, independent of how the file arrived — picked, dropped, or set on
 * the hidden `<input>`. Each route validates and reads the same way, so they cannot drift apart.
 */
import { notify } from '@modeler/app/noticeStore';
import { executeCommand } from '@modeler/commandBus';
import { linkOpenedFile } from '@modeler/diagram/fileHandle';
import { OPENABLE_EXTENSIONS } from '@modeler/export/formats';
import type { Modeler } from '@modeler/bpmn/types';

export const OPEN_INVALID_MESSAGE =
  'Choose a .studyflow.yaml, .bpmn, .svg, .png, or jsPsych .json file.';

export const OPEN_FAILURE_MESSAGE =
  'Could not open that file. Check it is a studyflow or BPMN diagram, then try again.';

export const isOpenable = (filename: string): boolean =>
  OPENABLE_EXTENSIONS.some((extension) => filename.toLowerCase().endsWith(extension));

/** Only the PNG carries its diagram in bytes; everything else this opens is text. */
export const isBinaryDiagram = (filename: string): boolean => filename.toLowerCase().endsWith('.png');

/**
 * Reads one file onto the canvas. A `handle` — which a pick or a drop can carry, but the
 * `<input>` never does — links the file, so later saves write back into it.
 */
export async function openDiagramFile(
  modeler: Modeler,
  file: File,
  handle?: FileSystemFileHandle,
): Promise<boolean> {
  if (!isOpenable(file.name)) {
    notify('error', OPEN_INVALID_MESSAGE);
    return false;
  }
  try {
    const content = isBinaryDiagram(file.name) ? await file.arrayBuffer() : await file.text();
    await executeCommand(modeler, { type: 'OpenDiagram', filename: file.name, content });
    if (handle) linkOpenedFile(handle, file);
    return true;
  } catch (err: any) {
    notify('error', err?.message || OPEN_FAILURE_MESSAGE);
    console.error(err);
    return false;
  }
}

/** The handle behind a dropped file, where the browser offers one. */
export async function droppedHandle(item: DataTransferItem): Promise<FileSystemFileHandle | undefined> {
  const handle = await item.getAsFileSystemHandle?.().catch(() => null);
  return handle?.kind === 'file' ? (handle as FileSystemFileHandle) : undefined;
}
