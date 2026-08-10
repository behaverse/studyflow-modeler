import StudyflowContextPad from '@/modeler/contextPad/ContextPad';
import ColorPickerProvider from '@/modeler/contextPad/ColorPickerProvider';
import AppendMenuProvider from '@/modeler/contextPad/AppendMenuProvider';

export default {
  __init__: [
    'studyFlowContextPad',
    'colorPickerProvider',
    'studyFlowAppendMenuProvider',
  ],
  studyFlowContextPad: ['type', StudyflowContextPad],
  studyFlowAppendMenuProvider: ['type', AppendMenuProvider],
  colorPickerProvider: ['type', ColorPickerProvider],
};
