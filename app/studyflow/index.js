import StudyFlowContextPad from './ContextPad';
import StudyFlowPalette from './Palette';
import StudyFlowRenderer from './Renderer';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import StudyFlowPropertiesProviderModule from './properties';

export const StudyFlowModule = {
  __init__: [
    'studyFlowContextPad',
    'studyFlowPalette',
    'studyFlowRenderer',
    'resizableTasks'
  ],
  __depends__: [
    SimulationModule,
    // StudyFlowPropertiesProviderModule
  ],
  studyFlowContextPad: ['type', StudyFlowContextPad],
  studyFlowPalette: ['type', StudyFlowPalette],
  studyFlowRenderer: ['type', StudyFlowRenderer],
  resizableTasks: ['type', ResizableTasks], 
};

export {Modeler} from './Modeler';
export { ModelerContext } from './Contexts';
export { Toolbar } from './toolbar';
