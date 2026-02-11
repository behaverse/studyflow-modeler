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
  studyFlowAppendMenuProvider: ['type', AppendMenuProvider],
  studyFlowContextPad: ['type', StudyflowContextPad],
  colorPopupProvider: [ 'type', ColorPopupProvider ],
  studyFlowReplaceMenuProvider: ['type', ReplaceMenuProvider],
};
