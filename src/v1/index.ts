import StudyflowContextPad from './ContextPad';
import StudyflowPalette from './Palette';
import StudyflowRenderer from './Renderer';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import ColorPopupProvider from './ColorPopup';
import CreateMenuProvider from './CreateMenuProvider';
import AppendMenuProvider from './AppendMenuProvider';

export const StudyflowModelerModule = {
  __init__: [
    'studyFlowContextPad',
    'studyFlowPalette',
    'studyFlowRenderer',
    'colorPopupProvider',
    'resizableTasks',
    'studyFlowCreateMenuProvider',
    'studyFlowAppendMenuProvider',
  ],
  __depends__: [
    SimulationModule,
  ],
  studyFlowCreateMenuProvider: ['type', CreateMenuProvider],
  studyFlowAppendMenuProvider: ['type', AppendMenuProvider],
  studyFlowContextPad: ['type', StudyflowContextPad],
  studyFlowPalette: ['type', StudyflowPalette],
  studyFlowRenderer: ['type', StudyflowRenderer],
  colorPopupProvider: [ 'type', ColorPopupProvider ],
  resizableTasks: ['type', ResizableTasks], 
};

export { ModelerContext } from './contexts';
export { NavBar } from './navbar';
// export { Modeler } from './Modeler';
