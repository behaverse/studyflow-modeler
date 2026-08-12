import { executeCommand } from '@modeler/commandBus';
import { openRunnerTab } from '@modeler/app/commands';
import { URLS } from '@modeler/constants';
import { ICONS } from '@modeler/icons';
import type { PaletteCommand, PaletteDialogId } from '@modeler/commandPalette/types';
import type { Modeler } from '@modeler/bpmn/types';

export type PaletteCommandDeps = {
  modeler: Modeler;
  isSimulating: boolean;
  openSettings: () => void;
  openDialog: (id: PaletteDialogId) => void;
  pickDiagramFile: () => void;
  pickJsPsychFile: () => void;
};

export function buildPaletteCommands(deps: PaletteCommandDeps): PaletteCommand[] {
  const { modeler, isSimulating, openSettings, openDialog, pickDiagramFile, pickJsPsychFile } = deps;

  return [
    {
      id: 'new',
      group: 'File',
      label: 'New...',
      icon: ICONS.fileNew,
      shortcut: '1',
      // Deliberate: the gallery's first entry is the blank canvas, so there is one way to start a diagram.
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

    {
      id: 'run',
      group: 'Run',
      label: 'Run',
      icon: ICONS.playFill,
      shortcut: '4',
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
      action: () => { window.open(URLS.docs, '_blank', 'noopener'); },
    },
    {
      id: 'github',
      group: 'App',
      label: 'GitHub',
      icon: ICONS.github,
      action: () => { window.open(URLS.githubRepo, '_blank', 'noopener'); },
    },
  ];
}
