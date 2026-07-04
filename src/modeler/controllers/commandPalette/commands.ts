/**
 * The single registry of palette commands.
 *
 * Order here is the order on screen: File -> Run -> View -> App. Within
 * File, commands follow the document lifecycle (create, open, save, exchange).
 * `Save As...` holds only round-trippable formats the modeler can reopen;
 * one-way outputs (images, schemas, metadata) live under `Export...`.
 *
 * Digit shortcuts fire only while the search box is empty and are assigned
 * in display order; `0` mirrors the editor-wide Cmd/Ctrl+0 zoom-reset
 * convention.
 */
import { executeCommand } from '@/modeler/controllers/commands';
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
      label: 'New',
      icon: ICONS.fileNew,
      shortcut: '1',
      action: () => {
        const ok = window.confirm('Replace the current diagram with an empty one? This cannot be undone.');
        if (ok) executeCommand(modeler, { type: 'new-diagram' }).catch(console.error);
      },
    },
    {
      id: 'new-from-template',
      group: 'File',
      label: 'New from Template...',
      icon: ICONS.grid,
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
      id: 'import-jspsych',
      group: 'File',
      label: 'Import jsPsych Timeline...',
      icon: ICONS.boxArrowInDown,
      hint: '.json',
      action: pickJsPsychFile,
    },
    {
      id: 'save-as',
      group: 'File',
      label: 'Save As...',
      icon: ICONS.download,
      shortcut: '3',
      children: [
        {
          id: 'save-studyflow',
          group: 'Save As',
          label: 'Studyflow...',
          icon: ICONS.fileYaml,
          hint: '.studyflow',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'studyflow' }),
        },
        {
          id: 'save-bpmn',
          group: 'Save As',
          label: 'BPMN 2.0 XML...',
          icon: ICONS.fileXml,
          hint: '.bpmn',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'bpmn' }),
        },
      ],
    },
    {
      id: 'export',
      group: 'File',
      label: 'Export...',
      icon: ICONS.boxArrowUp,
      shortcut: '4',
      children: [
        {
          id: 'export-svg',
          group: 'Export',
          label: 'SVG...',
          icon: ICONS.fileSvg,
          hint: '.svg',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'svg' }),
        },
        {
          id: 'export-png',
          group: 'Export',
          label: 'PNG...',
          icon: ICONS.filePng,
          hint: '.png',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'png' }),
        },
        {
          id: 'export-linkml',
          group: 'Export',
          label: 'Schema (data elements)...',
          icon: ICONS.fileYaml,
          hint: '.linkml.yaml',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'linkml' }),
        },
        {
          id: 'export-nidm',
          group: 'Export',
          label: 'NIDM-Results (analysis)...',
          icon: ICONS.diagram,
          hint: '.nidm.ttl',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'nidm' }),
        },
        {
          id: 'export-artemis',
          group: 'Export',
          label: 'ARTEM-IS (EEG methods)...',
          icon: ICONS.fileJson,
          hint: '.artemis.json',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'artemis' }),
        },
      ],
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
      shortcut: '5',
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

    // --- App
    {
      id: 'settings',
      group: 'App',
      label: 'Settings...',
      icon: ICONS.gear,
      shortcut: '6',
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
