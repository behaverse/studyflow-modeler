import StudyflowContextPad from '@/modeler/controllers/contextpad/ContextPad';
import ColorPopupProvider from '@/modeler/controllers/contextpad/ColorPopup';
import AppendMenuProvider from '@/modeler/controllers/contextpad/AppendMenuProvider';
import ReplaceMenuProvider from '@/modeler/controllers/contextpad/ReplaceMenuProvider';

export default {
  __init__: [
    'studyFlowContextPad',
    'colorPopupProvider',
    'studyFlowAppendMenuProvider',
    'studyFlowReplaceMenuProvider',
  ],
  studyFlowContextPad: ['type', StudyflowContextPad],
  studyFlowAppendMenuProvider: ['type', AppendMenuProvider],
  studyFlowReplaceMenuProvider: ['type', ReplaceMenuProvider],
  colorPopupProvider: ['type', ColorPopupProvider],
};
