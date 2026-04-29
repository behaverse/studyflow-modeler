import StudyflowRenderer from './render';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import ContextPadModule from './contextpad';
import PaletteModule from './palette';
import StudyflowExamplesModule from './moddle/examples';

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
    StudyflowExamplesModule
  ],
  studyFlowRenderer: ['type', StudyflowRenderer],
  resizableTasks: ['type', ResizableTasks],
};

export { ModelerContext } from './contexts';
