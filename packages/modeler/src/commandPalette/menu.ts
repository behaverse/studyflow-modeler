import { executeCommand } from '@modeler/commandBus';
import { pressRun } from '@modeler/composer/run';
import { saveLinkedFile } from '@modeler/diagram/save';
import { MOD_LABEL, URLS } from '@modeler/constants';
import { ICONS } from '@modeler/icons';
import { getPaletteIconForBpmnType } from '@modeler/palette/groups';
import type { PaletteCommand } from '@modeler/commandPalette/types';
import type { DialogId } from '@modeler/app/Dialogs';
import type { Editor } from '@modeler/editor/port';
import { reportingDocuments } from '@modeler/skillModules';
import { openView } from '@modeler/views/store';

export type PaletteCommandDeps = {
  modeler: Editor;
  isSimulating: boolean;
  /** A simulation is held: it offers Resume and Step instead of Pause. */
  isPaused: boolean;
  openSettings: () => void;
  openDialog: (id: DialogId) => void;
  /** Name of the file the diagram is linked to, if any; it decides what "Save" is called. */
  linkedFileName?: string;
};

/** Every shape and every named flow of the study, as a row that shows it: found by name, id or type. */
export function buildElementEntries(modeler: Editor): PaletteCommand[] {
  return modeler.study.list()
    .filter((record) => record.kind === 'node' || !!record.name?.trim())
    .map((record) => {
      const type = (record.extension ?? record.type).split(':').pop()!;
      return {
        id: `element-${record.id}`,
        group: 'Elements',
        label: record.name?.trim() || record.id,
        hint: type,
        icon: getPaletteIconForBpmnType(record.type) ?? ICONS.square,
        keywords: `${record.id} ${type}`,
        action: () => executeCommand(modeler, { type: 'GoToElement', id: record.id }),
      };
    });
}

/** The group the app menu's commands are listed under once found: it names their home. */
const MENU_GROUP = 'Studyflow Menu';

export function buildPaletteCommands(deps: PaletteCommandDeps): PaletteCommand[] {
  const { modeler, isSimulating, isPaused, openSettings, openDialog, linkedFileName } = deps;
  const documents = reportingDocuments();

  return [
    // The app's own commands, whose home is the app menu: found here by name, not listed until something is typed.
    {
      id: 'new',
      group: MENU_GROUP,
      searchOnly: true,
      label: 'New...',
      icon: ICONS.fileNew,
      // The start page: the empty study, every shipped example as a template, and the files opened lately.
      keywords: 'example gallery template blank empty recent start',
      action: () => openDialog('gallery'),
    },
    {
      id: 'open',
      group: MENU_GROUP,
      searchOnly: true,
      label: 'Open File...',
      icon: ICONS.folderOpen,
      // Takes any diagram format, and the foreign ones skills open, converted on the way in.
      action: () => openDialog('open'),
    },
    // Format and destination live here; this is where an unlinked diagram gets its file.
    {
      id: 'save-as',
      group: MENU_GROUP,
      searchOnly: true,
      label: 'Save As...',
      icon: ICONS.save,
      hint: `${MOD_LABEL}⇧S`,
      keywords: 'export download publish png svg tiff yaml bpmn copy',
      action: () => openDialog('save'),
    },
    // Nothing to overwrite until a file is linked, so until then "Save As..." is the only save.
    ...(linkedFileName ? [{
      id: 'save',
      group: MENU_GROUP,
      searchOnly: true,
      label: `Save ${linkedFileName}`,
      icon: ICONS.save,
      hint: `${MOD_LABEL}S`,
      keywords: 'overwrite write file',
      // Same gesture as ⌘S: writes straight back into the linked file, no dialog.
      action: () => { void saveLinkedFile(modeler); },
    }] : []),
    {
      id: 'settings',
      group: MENU_GROUP,
      searchOnly: true,
      label: 'Settings',
      icon: ICONS.gear,
      keywords: 'app preferences',
      action: openSettings,
    },
    {
      id: 'help',
      group: MENU_GROUP,
      searchOnly: true,
      label: 'Help',
      icon: ICONS.help,
      keywords: 'docs documentation manual guide',
      action: () => { window.open(URLS.docs, '_blank', 'noopener'); },
    },

    {
      id: 'run',
      group: 'Run',
      label: 'Run',
      icon: ICONS.run,
      // The composer's own press: it asks first when the plan has problems, and claims the runner's tab in this gesture.
      action: () => pressRun(modeler),
    },
    {
      id: 'simulate',
      group: 'Run',
      label: isSimulating ? 'Stop Simulation' : 'Start Simulation',
      icon: isSimulating ? ICONS.stop : ICONS.simulate,
      action: () => executeCommand(modeler, { type: 'ToggleSimulation' }),
    },
    ...(isSimulating ? [{
      id: 'simulation-pause',
      group: 'Run',
      label: isPaused ? 'Resume Simulation' : 'Pause Simulation',
      icon: isPaused ? ICONS.play : ICONS.pause,
      hint: 'Space',
      action: () => executeCommand(modeler, { type: 'PauseSimulation' }),
    }, {
      id: 'simulation-step',
      group: 'Run',
      label: 'Step Simulation',
      icon: ICONS.chevronRight,
      hint: '→',
      // A step plays on from a hold: from a running simulation it holds first.
      action: () => {
        if (!modeler.simulation.isPaused()) modeler.simulation.pause();
        return executeCommand(modeler, { type: 'StepSimulation' });
      },
    }] : []),

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
      id: 'tidy-layout',
      group: 'View',
      label: 'Tidy Layout',
      icon: ICONS.tidy,
      keywords: 'auto layout arrange clean up',
      action: () => executeCommand(modeler, { type: 'TidyLayout' })
        .catch((err) => console.warn('Tidy layout failed', err)),
    },
    {
      id: 'view-schedule',
      group: 'View',
      label: 'Show Schedule',
      icon: ICONS.schedule,
      keywords: 'timeline gantt durations',
      action: () => openView('schedule'),
    },
    {
      id: 'view-checklist',
      group: 'View',
      label: 'Show Checklist',
      icon: ICONS.checkbox,
      keywords: 'todo tasks review',
      action: () => openView('checklist'),
    },
    {
      id: 'view-manuscript',
      group: 'View',
      label: 'View as Manuscript...',
      icon: ICONS.manuscript,
      keywords: 'figure svg png drawio paper export',
      action: () => openDialog('manuscript'),
    },
    // Offered only while a skill in use draws a reporting document, and found by the guideline and document names
    // those skills give.
    ...(documents.length > 0 ? [{
      id: 'view-reporting',
      group: 'View',
      label: 'View as Reporting Diagram...',
      icon: ICONS.reporting,
      keywords: `guideline ${documents.map((document) => `${document.guideline} ${document.label}`).join(' ')}`,
      action: () => openDialog('reporting'),
    }] : []),
    {
      id: 'view-provenance',
      group: 'View',
      label: 'Show Provenance',
      icon: ICONS.history,
      keywords: 'runs history record',
      shortcut: 'p',
      action: () => openView('provenance'),
    },
  ];
}
