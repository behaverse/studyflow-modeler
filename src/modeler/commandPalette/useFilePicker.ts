import { notify } from '@/modeler/app/noticeStore';
import { useCallback, useRef, type ChangeEvent } from 'react';

/** `isValid` and `isBinary` receive the filename already lowercased. */
type FilePickerOptions = {
  accept: string;
  testId: string;
  isValid: (filename: string) => boolean;
  invalidMessage: string;
  isBinary?: (filename: string) => boolean;
  onText: (filename: string, content: string | ArrayBuffer | null) => Promise<unknown> | unknown;
  failureMessage: string;
};

export function useFilePicker(options: FilePickerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!options.isValid(file.name.toLowerCase())) {
      notify('error', options.invalidMessage);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        await options.onText(file.name, reader.result);
      } catch (err: any) {
        notify('error', err?.message || options.failureMessage);
        console.error(err);
      }
    };
    if (options.isBinary?.(file.name.toLowerCase())) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  // Stable identity: callers list it in dependency arrays.
  const open = useCallback(() => inputRef.current?.click(), []);

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
