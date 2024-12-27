import BaseModule from 'bpmn-js-token-simulation/lib/base';
import DisableModelingModule from 'bpmn-js-token-simulation/lib/features/disable-modeling';

import ToggleMode from './ToggleMode';
import TokenSimulationEditorActionsModule from 'bpmn-js-token-simulation/lib/features/editor-actions';
import TokenSimulationKeyboardBindingsModule from 'bpmn-js-token-simulation/lib/features/keyboard-bindings';

export default {
  __depends__: [
    BaseModule,
    DisableModelingModule,
    TokenSimulationEditorActionsModule,
    TokenSimulationKeyboardBindingsModule
  ],
  __init__: [
    'toggleMode',
  ],
  toggleMode: [ 'type', ToggleMode ]
};