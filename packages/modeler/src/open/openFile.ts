/**
 * Opening a file, however it arrived: picked, dropped, set on the hidden `<input>`, or taken from the recent ones.
 * Every route validates and reads it the same way, so they cannot drift apart.
 */
import { useCallback, useRef, type ChangeEvent } from 'react';
import { notify } from '@modeler/app/noticeStore';
import { executeCommand } from '@modeler/commandBus';
import {
  DIAGRAM_OPEN_ACCEPT,
  ensureWritePermission,
  linkOpenedFile,
  pickFileToOpen,
  readFile,
  rememberOpenedFile,
  supportsFileSystemAccess,
} from '@modeler/diagram/fileHandle';
import { forgetRecentFile, type RecentFile } from '@modeler/diagram/recentFiles';
import { servedFileHandle } from '@modeler/diagram/servedFile';
import { IMPORTABLE_FORMATS, OPENABLE_EXTENSIONS, OPENERS, importableFormatFor } from '@modeler/diagram/formats';
import type { Editor } from '@modeler/editor/port';

const OPEN_INVALID_MESSAGE = `Choose a ${[
  ...IMPORTABLE_FORMATS.map((format) => format.extension),
  ...OPENERS.map((opener) => `${opener.label} ${opener.extension}`),
].join(', ')} file.`;

const OPEN_FAILURE_MESSAGE =
  'Could not open that file. Check it is a studyflow or BPMN diagram, then try again.';

const isOpenable = (filename: string): boolean =>
  OPENABLE_EXTENSIONS.some((extension) => filename.toLowerCase().endsWith(extension));

/** A PNG or a TIFF carries its diagram in bytes; everything else this opens is text. */
const isBinaryDiagram = (filename: string): boolean => {
  const format = importableFormatFor(filename);
  return format?.mimeType === 'image/png' || format?.mimeType === 'image/tiff';
};

/**
 * Reads one file onto the canvas. A `handle` links the file, so later saves write back into it; a pick or a drop
 * can carry one, the `<input>` never does. Without one, a save still writes the file's name in its format.
 */
export async function openDiagramFile(
  modeler: Editor,
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
    else rememberOpenedFile(file.name);
    return true;
  } catch (err: any) {
    notify('error', err?.message || OPEN_FAILURE_MESSAGE);
    console.error(err);
    return false;
  }
}

/**
 * Picking a diagram to open: the File System Access picker where the browser has one, the only way to come
 * away holding a writable handle (so saves write back into the file), else the hidden `<input>`, which the
 * CLI and the e2e specs drive (`open-file-input`) and so stays mounted. `onOpened` runs once a file is on the canvas.
 */
export function useDiagramPicker(modeler: Editor, onOpened: () => void) {
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(() => {
    if (!supportsFileSystemAccess()) {
      inputRef.current?.click();
      return;
    }
    void (async () => {
      const handle = await pickFileToOpen(DIAGRAM_OPEN_ACCEPT, 'readwrite');
      // No handle: the user closed the picker.
      if (handle && await openDiagramFile(modeler, await handle.getFile(), handle)) onOpened();
    })().catch((err) => {
      notify('error', err?.message || OPEN_FAILURE_MESSAGE);
      console.error(err);
    });
  }, [modeler, onOpened]);

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && await openDiagramFile(modeler, file)) onOpened();
  };

  return {
    open,
    inputProps: {
      ref: inputRef,
      type: 'file' as const,
      accept: OPENABLE_EXTENSIONS.join(','),
      'data-testid': 'open-file-input',
      className: 'hidden',
      onChange,
    },
  };
}

/**
 * Opens one of the recent files (`diagram/recentFiles.ts`), linked as it was: by its handle, or over the URL the
 * desktop app serves it at. It must run inside a click: the browser asks again about a file of the disk's from an
 * earlier session. A file that is no longer there leaves the list.
 */
export async function openRecentFile(modeler: Editor, recent: RecentFile): Promise<boolean> {
  const handle = 'handle' in recent ? recent.handle : servedFileHandle(recent.url, recent.name);
  const permission = await ensureWritePermission(handle, { request: true }).catch(() => 'denied' as const);
  if (permission !== 'granted') {
    notify('error', `The browser did not grant permission to open ${recent.name}.`);
    return false;
  }
  const file = await readFile(handle);
  if (!file) {
    await forgetRecentFile(recent);
    notify('error', `${recent.name} is no longer where it was.`);
    return false;
  }
  return openDiagramFile(modeler, file, handle);
}

/** The handle behind a dropped file, where the browser offers one. */
export async function droppedHandle(item: DataTransferItem): Promise<FileSystemFileHandle | undefined> {
  const handle = await item.getAsFileSystemHandle?.().catch(() => null);
  return handle?.kind === 'file' ? (handle as FileSystemFileHandle) : undefined;
}
