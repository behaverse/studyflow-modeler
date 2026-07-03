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
import { executeCommand } from '../../commands';
import { URLS } from '../../constants';
import type { PaletteCommand, PaletteDialogId } from './types';

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
      icon: 'iconify bi--file-earmark-plus',
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
      icon: 'iconify bi--grid-1x2',
      action: () => openDialog('templates'),
    },
    {
      id: 'open',
      group: 'File',
      label: 'Open File...',
      icon: 'iconify bi--folder2-open',
      shortcut: '2',
      action: pickDiagramFile,
    },
    {
      id: 'examples',
      group: 'File',
      label: 'Examples...',
      icon: 'iconify bi--collection',
      action: () => openDialog('examples'),
    },
    {
      id: 'import-jspsych',
      group: 'File',
      label: 'Import jsPsych Timeline...',
      icon: 'iconify bi--box-arrow-in-down',
      hint: '.json',
      action: pickJsPsychFile,
    },
    {
      id: 'save-as',
      group: 'File',
      label: 'Save As...',
      icon: 'iconify bi--download',
      shortcut: '3',
      children: [
        {
          id: 'save-studyflow',
          group: 'Save As',
          label: 'Studyflow...',
          icon: 'iconify bi--filetype-yml',
          hint: '.studyflow',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'studyflow' }),
        },
        {
          id: 'save-bpmn',
          group: 'Save As',
          label: 'BPMN 2.0 XML...',
          icon: 'iconify bi--filetype-xml',
          hint: '.bpmn',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'bpmn' }),
        },
      ],
    },
    {
      id: 'export',
      group: 'File',
      label: 'Export...',
      icon: 'iconify bi--box-arrow-up',
      shortcut: '4',
      children: [
        {
          id: 'export-svg',
          group: 'Export',
          label: 'SVG...',
          icon: 'iconify bi--filetype-svg',
          hint: '.svg',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'svg' }),
        },
        {
          id: 'export-png',
          group: 'Export',
          label: 'PNG...',
          icon: 'iconify bi--filetype-png',
          hint: '.png',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'png' }),
        },
        {
          id: 'export-linkml',
          group: 'Export',
          label: 'Schema (data elements)...',
          icon: 'iconify bi--filetype-yml',
          hint: '.linkml.yaml',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'linkml' }),
        },
        {
          id: 'export-nidm',
          group: 'Export',
          label: 'NIDM-Results (analysis)...',
          icon: 'iconify bi--diagram-3',
          hint: '.nidm.ttl',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'nidm' }),
        },
        {
          id: 'export-artemis',
          group: 'Export',
          label: 'ARTEM-IS (EEG methods)...',
          icon: 'iconify bi--filetype-json',
          hint: '.artemis.json',
          action: () => executeCommand(modeler, { type: 'save-diagram', fileType: 'artemis' }),
        },
      ],
    },
    {
      id: 'publish',
      group: 'File',
      label: 'Publish...',
      icon: 'iconify bi--broadcast-pin',
      action: () => openDialog('publish'),
    },

    // --- Run
    {
      id: 'run',
      group: 'Run',
      label: 'Run',
      icon: 'iconify bi--play-fill',
      shortcut: '5',
      action: () => executeCommand(modeler, { type: 'open-runner' }),
    },
    {
      id: 'simulate',
      group: 'Run',
      label: isSimulating ? 'Stop Simulation' : 'Start Simulation',
      icon: isSimulating ? 'iconify bi--stop' : 'iconify bi--play',
      action: () => executeCommand(modeler, { type: 'toggle-simulation' }),
    },

    // --- View
    {
      id: 'reset-zoom',
      group: 'View',
      label: 'Reset Zoom',
      icon: 'iconify bi--fullscreen',
      shortcut: '0',
      action: () => executeCommand(modeler, { type: 'reset-zoom' })
        .catch((err) => console.warn('Zoom to fit failed', err)),
    },
    {
      id: 'view-checklist',
      group: 'View',
      label: 'View as Checklist...',
      icon: 'iconify bi--check2-square',
      action: () => openDialog('checklist'),
    },
    {
      id: 'view-gantt',
      group: 'View',
      label: 'View as Gantt...',
      icon: 'iconify bi--bar-chart-steps',
      action: () => openDialog('gantt'),
    },

    // --- App
    {
      id: 'settings',
      group: 'App',
      label: 'Settings...',
      icon: 'iconify bi--gear',
      shortcut: '6',
      action: openSettings,
    },
    {
      id: 'docs',
      group: 'App',
      label: 'Docs',
      icon: 'iconify bi--book',
      action: () => window.open(URLS.docs, '_blank'),
    },
    {
      id: 'github',
      group: 'App',
      label: 'GitHub',
      icon: 'iconify bi--github',
      action: () => window.open(URLS.githubRepo, '_blank'),
    },
  ];
}
