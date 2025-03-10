import StudyFlowContextPad from './ContextPad';
import StudyFlowPalette from './Palette';
import StudyFlowRenderer from './Renderer';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import ColorPopupProvider from './ColorPopup';
import CreateMenuProvider from './CreateMenuProvider';
import AppendMenuProvider from './AppendMenuProvider';

export const StudyFlowModule = {
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
  studyFlowContextPad: ['type', StudyFlowContextPad],
  studyFlowPalette: ['type', StudyFlowPalette],
  studyFlowRenderer: ['type', StudyFlowRenderer],
  colorPopupProvider: [ 'type', ColorPopupProvider ],
  resizableTasks: ['type', ResizableTasks], 
};

export { ModelerContext } from './contexts';
export { Toolbar } from './toolbar';
// export { Modeler } from './Modeler';
