/**
 * The single registry of palette commands.
 *
 * Order here is the order on screen: File -> Run -> View -> App. Within
 * File, commands follow the document lifecycle (create, open, export, publish).
 *
 * Getting a diagram in and out is deliberately three shapes, not a tree of
 * format submenus: `Open File...` is the browser's own file dialog (it takes
 * every format the modeler reads), `Import...` is a submenu for foreign
 * formats that need their own converter, and `Export...` opens one dialog
 * listing every output format with its options.
 *
 * Digit shortcuts fire only while the search box is empty and are assigned
 * in display order; `0` mirrors the editor-wide Cmd/Ctrl+0 zoom-reset
 * convention.
 */
import { executeCommand } from '@/modeler/controllers/commandBus';
import { URLS } from '@/modeler/infra/constants';
import { ICONS } from '@/icons';
import type { PaletteCommand, PaletteDialogId } from '@/modeler/models/commandPalette/types';

export type PaletteCommandDeps = {
  /** Modeler DI container; leaf actions dispatch through `executeCommand`. */
  modeler: any;
  isSimulating: boolean;
  openSettings: () => void;
  /** Open one of the palette-owned modal dialogs. */
  openDialog: (id: PaletteDialogId) => void;
  /** Trigger the hidden file inputs (see `useFilePicker`). */
  pickDiagramFile: () => void;
  pickJsPsychFile: () => void;
};

export function buildPaletteCommands(deps: PaletteCommandDeps): PaletteCommand[] {
  const { modeler, isSimulating, openSettings, openDialog, pickDiagramFile, pickJsPsychFile } = deps;

  return [
    // --- File
    {
      id: 'new',
      group: 'File',
      label: 'New...',
      icon: ICONS.fileNew,
      shortcut: '1',
      // The blank canvas is the first entry in the same gallery, so there is
      // exactly one way to start a diagram.
      action: () => openDialog('templates'),
    },
    {
      id: 'open',
      group: 'File',
      label: 'Open File...',
      icon: ICONS.folderOpen,
      shortcut: '2',
      action: pickDiagramFile,
    },
    {
      id: 'examples',
      group: 'File',
      label: 'Examples...',
      icon: ICONS.collection,
      action: () => openDialog('examples'),
    },
    {
      id: 'import',
      group: 'File',
      label: 'Import...',
      icon: ICONS.boxArrowInDown,
      children: [
        {
          id: 'import-jspsych',
          group: 'Import',
          label: 'jsPsych Timeline...',
          icon: ICONS.fileJson,
          hint: '.json',
          action: pickJsPsychFile,
        },
      ],
    },
    {
      id: 'export',
      group: 'File',
      label: 'Export...',
      icon: ICONS.download,
      shortcut: '3',
      action: () => openDialog('export'),
    },
    {
      id: 'publish',
      group: 'File',
      label: 'Publish...',
      icon: ICONS.broadcast,
      action: () => openDialog('publish'),
    },

    // --- Run
    {
      id: 'run',
      group: 'Run',
      label: 'Run',
      icon: ICONS.playFill,
      shortcut: '4',
      action: () => executeCommand(modeler, { type: 'open-runner' }),
    },
    {
      id: 'simulate',
      group: 'Run',
      label: isSimulating ? 'Stop Simulation' : 'Start Simulation',
      icon: isSimulating ? ICONS.stop : ICONS.play,
      action: () => executeCommand(modeler, { type: 'toggle-simulation' }),
    },

    // --- View
    {
      id: 'reset-zoom',
      group: 'View',
      label: 'Reset Zoom',
      icon: ICONS.fullscreen,
      shortcut: '0',
      action: () => executeCommand(modeler, { type: 'reset-zoom' })
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
      icon: ICONS.barChartSteps,
      action: () => openDialog('gantt'),
    },
    {
      id: 'view-provenance',
      group: 'View',
      label: 'View Provenance...',
      icon: ICONS.history,
      action: () => openDialog('provenance'),
    },

    // --- App
    {
      id: 'settings',
      group: 'App',
      label: 'Settings...',
      icon: ICONS.gear,
      shortcut: '5',
      action: openSettings,
    },
    {
      id: 'docs',
      group: 'App',
      label: 'Docs',
      icon: ICONS.book,
      action: () => window.open(URLS.docs, '_blank'),
    },
    {
      id: 'github',
      group: 'App',
      label: 'GitHub',
      icon: ICONS.github,
      action: () => window.open(URLS.githubRepo, '_blank'),
    },
  ];
}
