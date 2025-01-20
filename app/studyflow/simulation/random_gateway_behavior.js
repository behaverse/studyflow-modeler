import {
  filterSequenceFlows
} from 'bpmn-js-token-simulation/lib/simulator/util/ModelUtil';

export default function RandomGatewayBehavior(simulator, scopeBehavior) {
  this._scopeBehavior = scopeBehavior;
  this._simulator = simulator;

  simulator.registerBehavior('studyflow:RandomGateway', this);
}

RandomGatewayBehavior.prototype.enter = function(context) {
  this._simulator.exit(context);
};

RandomGatewayBehavior.prototype.exit = function(context) {

  const {
    element,
    scope
  } = context;

  // depends on UI to properly configure activeOutgoing for
  // each exclusive gateway

  const outgoings = filterSequenceFlows(element.outgoing);

  if (outgoings.length === 1) {
    return this._simulator.enter({
      element: outgoings[0],
      scope: scope.parent
    });
  }

//   const {
//     activeOutgoing
    //   } = this._simulator.getConfig(element);
  const activeOutgoing = outgoings[Math.floor(Math.random() * outgoings.length)];

  const outgoing = outgoings.find(o => o === activeOutgoing);

  if (!outgoing) {
    return this._scopeBehavior.tryExit(scope.parent, scope);
  }

  return this._simulator.enter({
    element: outgoing,
    scope: scope.parent
  });
};

RandomGatewayBehavior.$inject = [
  'simulator',
  'scopeBehavior'
];
