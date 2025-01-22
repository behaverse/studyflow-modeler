import StudyFlowContextPad from './ContextPad';
import StudyFlowPalette from './Palette';
import StudyFlowRenderer from './Renderer';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';

export const StudyFlowModule = {
  __init__: [
    'studyFlowContextPad',
    'studyFlowPalette',
    'studyFlowRenderer',
    'resizableTasks'
  ],
  __depends__: [
    SimulationModule,
  ],
  studyFlowContextPad: ['type', StudyFlowContextPad],
  studyFlowPalette: ['type', StudyFlowPalette],
  studyFlowRenderer: ['type', StudyFlowRenderer],
  resizableTasks: ['type', ResizableTasks], 
};

export { ModelerContext } from '../contexts';
export { Toolbar } from './toolbar';
