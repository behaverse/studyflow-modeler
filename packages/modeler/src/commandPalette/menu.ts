import { executeCommand } from '@modeler/commandBus';
import { openRunnerTab } from '@modeler/app/commands';
import { saveLinkedFile } from '@modeler/diagram/save';
import { MOD_LABEL, URLS } from '@modeler/constants';
import { ICONS } from '@modeler/icons';
import type { PaletteCommand, PaletteDialogId } from '@modeler/commandPalette/types';
import type { Editor } from '@modeler/editor/port';

export type PaletteCommandDeps = {
  modeler: Editor;
  isSimulating: boolean;
  openSettings: () => void;
  openDialog: (id: PaletteDialogId) => void;
  openReplay: () => void;
  /** Name of the file the diagram is linked to, if any; it decides what "Save" is called. */
  linkedFileName?: string;
};

export function buildPaletteCommands(deps: PaletteCommandDeps): PaletteCommand[] {
  const { modeler, isSimulating, openSettings, openDialog, openReplay, linkedFileName } = deps;

  return [
    {
      id: 'new',
      group: 'File',
      tile: true,
      label: 'New...',
      icon: ICONS.fileNew,
      shortcut: '1',
      // One gallery: the blank canvas, then every shipped example, shelved by what it demonstrates.
      action: () => openDialog('gallery'),
    },
    {
      id: 'open',
      group: 'File',
      tile: true,
      label: 'Open File...',
      icon: ICONS.folderOpen,
      shortcut: '2',
      // Takes any diagram format, and a jsPsych timeline, which it converts on the way in.
      action: () => openDialog('open'),
    },
    // Format and destination live here; this is where an unlinked diagram gets its file.
    {
      id: 'save-as',
      group: 'File',
      tile: false,
      label: 'Save As...',
      icon: ICONS.save,
      hint: `${MOD_LABEL}⇧S`,
      keywords: 'export download publish png svg yaml bpmn copy',
      action: () => openDialog('save'),
    },
    // Not a file command, but it shares the tile row up top, and the row is one group.
    {
      id: 'settings',
      group: 'File',
      tile: true,
      label: 'Settings',
      icon: ICONS.gear,
      shortcut: '3',
      keywords: 'app preferences',
      action: openSettings,
    },
    {
      id: 'docs',
      group: 'File',
      label: 'Docs',
      tile: true,
      icon: ICONS.book,
      action: () => { window.open(URLS.docs, '_blank', 'noopener'); },
    },
    // Nothing to overwrite until a file is linked, so until then "Save As..." is the only save.
    ...(linkedFileName ? [{
      id: 'save',
      group: 'File',
      label: `Save ${linkedFileName}`,
      icon: ICONS.save,
      hint: `${MOD_LABEL}S`,
      keywords: 'overwrite write file',
      // Same gesture as the title-bar chip: writes straight back into the linked file, no dialog.
      action: () => { void saveLinkedFile(modeler); },
    }] : []),

    {
      id: 'run',
      group: 'Run',
      label: 'Run',
      icon: ICONS.playFill,
      // `openRunnerTab()` first: the runner tab has to be claimed inside this gesture.
      action: () => executeCommand(modeler, { type: 'OpenRunner', target: openRunnerTab() }),
    },
    {
      id: 'simulate',
      group: 'Run',
      label: isSimulating ? 'Stop Simulation' : 'Start Simulation',
      icon: isSimulating ? ICONS.stop : ICONS.play,
      action: () => executeCommand(modeler, { type: 'ToggleSimulation' }),
    },

    {
      id: 'reset-zoom',
      group: 'View',
      label: 'Reset Zoom',
      icon: ICONS.fullscreen,
      shortcut: '0',
      action: () => executeCommand(modeler, { type: 'ResetZoom' })
        .catch((err) => console.warn('Zoom to fit failed', err)),
    },
    {
      id: 'view-checklist',
      group: 'View',
      label: 'View as Checklist...',
      icon: ICONS.checkSquare,
      action: () => openDialog('checklist'),
    },
    {
      id: 'view-gantt',
      group: 'View',
      label: 'View as Gantt...',
      icon: ICONS.gantt,
      action: () => openDialog('gantt'),
    },
    {
      id: 'view-provenance',
      group: 'View',
      label: 'View Provenance...',
      icon: ICONS.history,
      shortcut: 'p',
      action: () => openDialog('provenance'),
    },
    {
      id: 'replay-provenance',
      group: 'View',
      label: 'Replay Provenance',
      icon: ICONS.playFill,
      action: openReplay,
    },
  ];
}
