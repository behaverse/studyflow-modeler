import StudyflowContextPad from './ContextPad';
import ColorPopupProvider from './ColorPopup';
import AppendMenuProvider from './AppendMenuProvider';

export default {
  __init__: [
    'studyFlowContextPad',
    'colorPopupProvider',
    'studyFlowAppendMenuProvider',
  ],
  studyFlowAppendMenuProvider: ['type', AppendMenuProvider],
  studyFlowContextPad: ['type', StudyflowContextPad],
  colorPopupProvider: [ 'type', ColorPopupProvider ],
};
