import TokenSimulationModule from 'bpmn-js-token-simulation';

import RandomGatewaySettings from './RandomGatewaySettings';
import StudyflowActivityBehavior from './ActivityBehavior';
import RandomGatewayBehavior from './RandomGatewayBehavior';
import StudyBehavior from './StudyBehavior';

export default {
  __depends__: [
    TokenSimulationModule,
  ],
  __init__: [
    'toggleMode',
    'studyFlowActivityBehavior',
    'randomGatewayBehavior',
    'randomGatewaySettings',
    'processBehavior'
  ],
  toggleMode: ['type', function(){}],
  studyFlowActivityBehavior: ['type', StudyflowActivityBehavior],
  randomGatewayBehavior: ['type', RandomGatewayBehavior],
  randomGatewaySettings: ['type', RandomGatewaySettings],
  processBehavior: ['type', StudyBehavior]

};
