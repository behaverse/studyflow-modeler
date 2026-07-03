import { useRef, type ChangeEvent } from 'react';

type FilePickerOptions = {
  /** `accept` attribute for the hidden input, e.g. '.json'. */
  accept: string;
  testId: string;
  /** Filename check (lowercased); rejected files surface `invalidMessage`. */
  isValid: (filename: string) => boolean;
  invalidMessage: string;
  /** Receives the file's text content; a rejected promise surfaces its message. */
  onText: (filename: string, content: string | ArrayBuffer | null) => Promise<unknown> | unknown;
  failureMessage: string;
};

/**
 * Hidden `<input type="file">` behind an imperative `open()`.
 *
 * Render `<input {...inputProps} />` somewhere in the tree (it stays mounted
 * and invisible, so tests can drive it via `setInputFiles`), then call
 * `open()` from a command action to show the browser's file picker.
 */
export function useFilePicker(options: FilePickerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!options.isValid(file.name.toLowerCase())) {
      alert(options.invalidMessage);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        await options.onText(file.name, reader.result);
      } catch (err: any) {
        alert(err?.message || options.failureMessage);
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return {
    open: () => inputRef.current?.click(),
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
