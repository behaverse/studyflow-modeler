/**
 * File System Access: Chromium ships the pickers and the per-handle permission methods, but
 * TypeScript's DOM lib (5.9) declares only the half the origin-private file system needs.
 *
 * These are global augmentations, so this file must never gain a top-level `import` or `export` —
 * one would make it a module and every declaration below would quietly stop applying. It holds
 * nothing else so that constraint stays obvious.
 *
 * Every member is optional: the feature check is not something a cast can skip.
 */
interface FilePickerAcceptType {
  description?: string;
  /** MIME essence (no `;charset=`, which the pickers reject) to the extensions it covers. */
  accept: Record<string, string[]>;
}

interface FilePickerOptions {
  types?: FilePickerAcceptType[];
  /** Chrome remembers a directory per id, so the next pick starts where the last one ended. */
  id?: string;
}

interface OpenFilePickerOptions extends FilePickerOptions {
  multiple?: boolean;
  /** `readwrite` makes the pick itself the write grant; later writes need no second prompt. */
  mode?: 'read' | 'readwrite';
}

interface SaveFilePickerOptions extends FilePickerOptions {
  suggestedName?: string;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  /** Must be called from inside a user gesture, or it resolves `denied` without asking. */
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DataTransferItem {
  /** A dropped file, as a handle rather than a snapshot — which is what makes it writable. */
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
