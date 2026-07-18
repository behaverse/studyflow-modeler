import StudyflowContextPad from '@/modeler/controllers/contextpad/ContextPad';
import ColorPopupProvider from '@/modeler/controllers/contextpad/ColorPopup';
import AppendMenuProvider from '@/modeler/controllers/contextpad/AppendMenuProvider';

export default {
  __init__: [
    'studyFlowContextPad',
    'colorPopupProvider',
    'studyFlowAppendMenuProvider',
  ],
  studyFlowContextPad: ['type', StudyflowContextPad],
  studyFlowAppendMenuProvider: ['type', AppendMenuProvider],
  colorPopupProvider: ['type', ColorPopupProvider],
};
