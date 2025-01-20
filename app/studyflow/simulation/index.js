import TokenSimulationModule from 'bpmn-js-token-simulation';

import StudyFlowActivityBehavior from './activity_behavior';
import StudyFlowRandomGatewayBehavior from './random_gateway_behavior';

export default {
  __depends__: [
    TokenSimulationModule,
  ],
  __init__: [
    'toggleMode',
    'studyFlowActivityBehavior',
    'studyFlowRandomGatewayBehavior'],
  toggleMode: ['type', function(){}],
  studyFlowActivityBehavior: ['type', StudyFlowActivityBehavior],
  studyFlowRandomGatewayBehavior: [
    'type', StudyFlowRandomGatewayBehavior],
};
