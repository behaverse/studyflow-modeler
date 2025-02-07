import { is } from 'bpmn-js-token-simulation/lib/util/ElementHelper';

import { TOGGLE_MODE_EVENT } from 'bpmn-js-token-simulation/lib/util/EventHelper';


const SELECTED_COLOR = '--token-simulation-grey-darken-30';

function getNext(gateway, sequenceFlow) {
  var outgoing = gateway.outgoing.filter(isSequenceFlow);

  var index = outgoing.indexOf(sequenceFlow || gateway.sequenceFlow);

  if (outgoing[index + 1]) {
    return outgoing[index + 1];
  } else {
    return outgoing[0];
  }
}

function isSequenceFlow(connection) {
  return is(connection, 'bpmn:SequenceFlow');
}

export default function RandomGatewaySettings(
    eventBus, elementRegistry,
    elementColors, simulator, simulationStyles) {

  this._elementRegistry = elementRegistry;
  this._elementColors = elementColors;
  this._simulator = simulator;
  this._simulationStyles = simulationStyles;

  eventBus.on(TOGGLE_MODE_EVENT, event => {
    if (event.active) {
      this.setSequenceFlowsDefault();
    }
  });
}

RandomGatewaySettings.prototype.setSequenceFlowsDefault = function() {
  const exclusiveGateways = this._elementRegistry.filter(element => {
    return is(element, 'studyflow:RandomGateway');
  });

  for (const gateway of exclusiveGateways) {
    // set default color
    gateway.outgoing.forEach(outgoing => {
      const stroke = this._simulationStyles.get(SELECTED_COLOR);
      this._elementColors.add(outgoing, 'random-gateway-settings', {
        stroke
      }, 2001);
    });
  }
};

RandomGatewaySettings.$inject = [
  'eventBus',
  'elementRegistry',
  'elementColors',
  'simulator',
  'simulationStyles'
];