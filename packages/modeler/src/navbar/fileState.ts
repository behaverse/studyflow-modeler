/**
 * What the nav bar says about the file the study saves into: where its edits go, how far they got, and what to do about
 * it. A function of the link and the few settings and browser traits that change the answer, with no DOM, so a unit
 * spec reads every state from a table.
 */
import type { LinkSnapshot } from '@modeler/diagram/fileHandle';
import { MOD_LABEL } from '@modeler/constants';
import { ICONS } from '@modeler/icons';

/** Where the study's edits go. */
export type Place =
  /** A file this page writes into: picked, or the one `studyflow edit` serves. */
  | 'disk'
  /** The file an open read without a handle: a save writes a new file of that name. */
  | 'copy'
  /** No file: the copy auto-save keeps in this browser. */
  | 'browser'
  /** No file, and auto-save is off. */
  | 'unsaved';

/** `where` is said only beside a state that leaves the file where it is. */
export type Status = { icon: string; where?: string; label: string; tone?: 'warning' | 'error' };

/** A button on the file card: the explicit save (which also re-asks permission), or the Save dialog. */
export type FileAction = { label: string; run: 'save' | 'saveAs'; primary?: boolean };

export type FileState = {
  place: Place;
  /** The file's name; none while the study is in no file. */
  name?: string;
  /** The nav bar's subtitle, and the card's status line. */
  status: Status;
  /** The card's account of the status, in a sentence. */
  detail: string;
  actions: FileAction[];
  /** When the linked file was last written, by anyone: its `lastModified`. */
  lastSaved?: number;
};

export type FileStateInput = {
  link: LinkSnapshot;
  /** Settings' auto-save keeps a copy in this browser. */
  keepsBrowserCopy: boolean;
  /** Settings' "Write to the opened file". */
  writesToFile: boolean;
  /** The linked file's format is cheap enough to rewrite on every edit (`autoSavable`): not an image. */
  formatAutoSaves: boolean;
  /** The browser has the file pickers, so a save can ask where a file goes. */
  canPickFiles: boolean;
};

const ON_DISK = { icon: ICONS.thisMachine, where: 'On this computer' };

function placeOf({ link, keepsBrowserCopy }: FileStateInput): Place {
  if (link.file) return 'disk';
  if (link.opened) return 'copy';
  return keepsBrowserCopy ? 'browser' : 'unsaved';
}

function statusOf({ link, canPickFiles }: FileStateInput, place: Place, writesEachEdit: boolean): Status {
  if (place === 'copy') return { icon: ICONS.download, label: canPickFiles ? 'Opened as a copy' : 'Saves as a download' };
  if (place === 'browser') return { icon: ICONS.browser, label: 'Only in this browser' };
  if (place === 'unsaved') return { icon: ICONS.warning, label: 'Not saved', tone: 'warning' };
  switch (link.state) {
    case 'blocked': return { icon: ICONS.lock, label: 'Needs permission', tone: 'warning' };
    case 'conflict': return { icon: ICONS.warning, label: 'Changed on disk', tone: 'warning' };
    case 'error': return { icon: ICONS.warning, label: 'Save failed', tone: 'error' };
    case 'clean': return { ...ON_DISK, label: 'Saved' };
    // With every edit written, an unsaved edit is one about to be.
    default: return { ...ON_DISK, label: link.state === 'saving' || writesEachEdit ? 'Saving...' : 'Unsaved changes' };
  }
}

function detailOf({ link, canPickFiles, formatAutoSaves }: FileStateInput, place: Place, writesEachEdit: boolean): string {
  if (place === 'copy') {
    return canPickFiles
      ? 'This page cannot write back into the file it opened, so a save asks where to put the study.'
      : 'This browser cannot write into files, so a save downloads a new copy.';
  }
  if (place === 'browser') return 'Auto-save keeps the study in this browser until you save it to a file.';
  if (place === 'unsaved') return 'Auto-save is off in Settings, so closing the tab loses the study.';
  if (link.state === 'blocked') return 'After a reload, the browser asks again before this page may write the file.';
  if (link.state === 'conflict') return link.message ?? '';
  if (link.state === 'error') return link.message ? `The last write failed: ${link.message}` : 'The last write failed.';
  if (writesEachEdit) return 'Every edit is written into this file.';
  return formatAutoSaves
    ? `Write to the opened file is off in Settings, so edits wait for ${MOD_LABEL}S.`
    : `An image is too slow to render on every edit, so edits wait for ${MOD_LABEL}S.`;
}

/** The save the state calls for, then Save As. */
function actionsOf({ link, canPickFiles }: FileStateInput, place: Place, writesEachEdit: boolean): FileAction[] {
  // With no file there is no name or format to save as, so the Save dialog asks for both.
  if (place === 'browser' || place === 'unsaved') return [{ label: 'Save...', run: 'saveAs', primary: true }];
  const actions: FileAction[] = [];
  if (place === 'copy') actions.push({ label: canPickFiles ? 'Save...' : 'Download', run: 'save', primary: true });
  else if (link.state === 'blocked') actions.push({ label: 'Allow editing', run: 'save', primary: true });
  else if (link.state === 'conflict') actions.push({ label: 'Replace the file', run: 'save', primary: true });
  else if (link.state === 'error') actions.push({ label: 'Try again', run: 'save', primary: true });
  else if (link.state === 'dirty' && !writesEachEdit) actions.push({ label: 'Save', run: 'save', primary: true });
  actions.push({ label: 'Save as...', run: 'saveAs' });
  return actions;
}

export function describeFile(input: FileStateInput): FileState {
  const { link, writesToFile, formatAutoSaves } = input;
  const place = placeOf(input);
  const writesEachEdit = !!link.file && writesToFile && formatAutoSaves;
  return {
    place,
    name: link.file?.name ?? link.opened?.name,
    status: statusOf(input, place, writesEachEdit),
    detail: detailOf(input, place, writesEachEdit),
    actions: actionsOf(input, place, writesEachEdit),
    lastSaved: link.file?.seenModified || undefined,
  };
}
