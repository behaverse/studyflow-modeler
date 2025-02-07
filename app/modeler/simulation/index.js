import TokenSimulationModule from 'bpmn-js-token-simulation';

import RandomGatewaySettings from './RandomGatewaySettings';
import StudyFlowActivityBehavior from './ActivityBehavior';
import RandomGatewayBehavior from './RandomGatewayBehavior';

export default {
  __depends__: [
    TokenSimulationModule,
  ],
  __init__: [
    'toggleMode',
    'studyFlowActivityBehavior',
    'randomGatewayBehavior',
    'randomGatewaySettings'],
  toggleMode: ['type', function(){}],
  studyFlowActivityBehavior: ['type', StudyFlowActivityBehavior],
  randomGatewayBehavior: ['type', RandomGatewayBehavior],
  randomGatewaySettings: ['type', RandomGatewaySettings]

};
