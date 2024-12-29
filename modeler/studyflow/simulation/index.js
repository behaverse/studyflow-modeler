import TokenSimulationModule from 'bpmn-js-token-simulation';

import ToggleMode from './ToggleMode';
import StudyFlowActivityBehavior from './activity_behavior';
import StudyFlowRandomAssignmentBehavior from './random_assignment_behavior';

export default {
  __depends__: [
    TokenSimulationModule,
  ],
  __init__: [
    'toggleMode',
    'studyFlowActivityBehavior',
    'studyFlowRandomAssignmentBehavior'],
  toggleMode: ['type', ToggleMode],
  studyFlowActivityBehavior: ['type', StudyFlowActivityBehavior],
  studyFlowRandomAssignmentBehavior: [
    'type', StudyFlowRandomAssignmentBehavior],
};
