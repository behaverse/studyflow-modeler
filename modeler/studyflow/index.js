import StudyFlowContextPad from './ContextPad';
import StudyFlowPalette from './Palette';
import StudyFlowRenderer from './Renderer';

const StudyFlowModule = {
  __init__: ['studyFlowContextPad', 'studyFlowPalette', 'studyFlowRenderer'],
  studyFlowContextPad: ['type', StudyFlowContextPad],
  studyFlowPalette: ['type', StudyFlowPalette],
  studyFlowRenderer: ['type', StudyFlowRenderer]
};

export default StudyFlowModule;
