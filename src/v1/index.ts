import StudyflowRenderer from './Renderer';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import PaletteModule from './palette';
import ContextPadModule from './contextpad';

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
export { NavBar } from './navbar';
// export { Modeler } from './Modeler';
