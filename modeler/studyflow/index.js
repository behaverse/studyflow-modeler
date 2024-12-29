import StudyFlowContextPad from './ContextPad';
import StudyFlowPalette from './Palette';
import StudyFlowRenderer from './Renderer';
import ResizableTasks from './ResizableTasks';
import SimulationModule from './simulation';
import ExportButton from './ExportButton';

const StudyFlowModule = {
  __init__: [
    'studyFlowContextPad',
    'studyFlowPalette',
    'studyFlowRenderer',
    'resizableTasks'
  ],
  __depends__: [
    SimulationModule,
    ExportButton
  ],
  studyFlowContextPad: ['type', StudyFlowContextPad],
  studyFlowPalette: ['type', StudyFlowPalette],
  studyFlowRenderer: ['type', StudyFlowRenderer],
  resizableTasks: ['type', ResizableTasks], 
};

export default StudyFlowModule;
