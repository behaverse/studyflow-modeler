import { notify } from '@modeler/app/noticeStore';
import { pickFileToOpen, supportsFileSystemAccess, type PickAccept } from '@modeler/diagram/fileHandle';
import { useCallback, useEffect, useRef, type ChangeEvent } from 'react';

/** `isValid` and `isBinary` receive the filename already lowercased. */
type PickerOptions = {
  accept: string;
  testId: string;
  isValid: (filename: string) => boolean;
  invalidMessage: string;
  isBinary?: (filename: string) => boolean;
  onText: (filename: string, content: string | ArrayBuffer | null) => Promise<unknown> | unknown;
  failureMessage: string;
  /**
   * What the File System Access picker should offer. Given one, `open` prefers that picker where
   * the browser has it, which is the only way to come away holding a writable handle; without one
   * — or in Firefox, Safari, and every mobile browser — the hidden `<input>` stays the way in.
   */
  picker?: PickAccept;
  /** Called with the handle the user picked, once the file has imported. */
  onPicked?: (handle: FileSystemFileHandle, file: File) => void;
};

function reject(options: PickerOptions, filename: string): boolean {
  if (options.isValid(filename.toLowerCase())) return false;
  notify('error', options.invalidMessage);
  return true;
}

/** The one way a picked file becomes a diagram, whichever picker produced it. */
async function importFile(options: PickerOptions, file: File, filename: string): Promise<boolean> {
  const binary = options.isBinary?.(filename.toLowerCase());
  try {
    await options.onText(filename, binary ? await file.arrayBuffer() : await file.text());
    return true;
  } catch (err: any) {
    notify('error', err?.message || options.failureMessage);
    console.error(err);
    return false;
  }
}

async function openWithPicker(options: PickerOptions): Promise<void> {
  // Write access is worth asking for only where the handle will be kept and written back.
  const handle = await pickFileToOpen(options.picker!, options.onPicked ? 'readwrite' : 'read');
  // No handle means the user closed the picker.
  if (!handle || reject(options, handle.name)) return;

  const file = await handle.getFile();
  if (await importFile(options, file, handle.name)) options.onPicked?.(handle, file);
}

export function useFilePicker(options: PickerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  // `open` keeps a stable identity — callers list it in dependency arrays — so it reads through a
  // ref. Effects have flushed long before any click can reach it, so the options are never stale.
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const current = optionsRef.current;
    if (!file || reject(current, file.name)) return;
    void importFile(current, file, file.name);
  };

  const open = useCallback(() => {
    const current = optionsRef.current;
    if (current.picker && supportsFileSystemAccess()) {
      openWithPicker(current).catch((err) => {
        notify('error', err?.message || current.failureMessage);
        console.error(err);
      });
      return;
    }
    inputRef.current?.click();
  }, []);

  return {
    open,
    inputProps: {
      ref: inputRef,
      type: 'file' as const,
      accept: options.accept,
      'data-testid': options.testId,
      className: 'hidden',
      onChange: handleChange,
    },
  };
}
