import StudyflowRenderer from './render';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import ContextPadModule from './contextpad';
import PaletteModule from './palette';
import StudyflowTemplatesModule from './moddle/templates';

export const StudyflowModelerModule = {
  __init__: [
    'studyFlowContextPad',
    'studyFlowRenderer',
    'colorPopupProvider',
    'resizableTasks',
    'studyFlowAppendMenuProvider',
  ],
  __depends__: [
    SimulationModule,
    PaletteModule,
    ContextPadModule,
    StudyflowTemplatesModule
  ],
  studyFlowRenderer: ['type', StudyflowRenderer],
  resizableTasks: ['type', ResizableTasks],
};

export { ModelerContext } from './contexts';
