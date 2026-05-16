import StudyflowContextPad from './ContextPad';
import ColorPopupProvider from './ColorPopup';
import AppendMenuProvider from './AppendMenuProvider';
import ReplaceMenuProvider from './ReplaceMenuProvider';

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
