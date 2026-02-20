import StudyflowRenderer from './draw';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import ContextPadModule from './contextpad';
import PaletteModule from './palette';

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
  ],
  studyFlowRenderer: ['type', StudyflowRenderer],
  resizableTasks: ['type', ResizableTasks],
};

export { ModelerContext } from './contexts';
