import {
  isImplicitStartEvent,
  isNoneStartEvent,
  isStartEvent
} from 'bpmn-js-token-simulation/lib/simulator/util/ModelUtil';



export default function StudyBehavior(
    simulator,
    scopeBehavior) {

  this._simulator = simulator;
  this._scopeBehavior = scopeBehavior;

  simulator.registerBehavior('studyflow:Study', this);
  simulator.registerBehavior('bpmn:Process', this);
  simulator.registerBehavior('bpmn:Participant', this);
}

StudyBehavior.prototype.signal = function(context) {

  const {
    element,
    startEvent,
    startNodes = this._findStarts(element, startEvent),
    scope
  } = context;

  if (!startNodes.length) {
    throw new Error('missing <startNodes> or <startEvent>');
  }

  for (const startNode of startNodes) {

    if (isStartEvent(startNode)) {
      this._simulator.signal({
        element: startNode,
        parentScope: scope
      });
    } else {
      this._simulator.enter({
        element: startNode,
        scope
      });
    }
  }

};

StudyBehavior.prototype.exit = function(context) {

  const {
    scope,
    initiator
  } = context;

  // ensure that all sub-scopes are destroyed

  this._scopeBehavior.destroyChildren(scope, initiator);
};

StudyBehavior.prototype._findStarts = function(element, startEvent) {

  const isStartEvent = startEvent
    ? (node) => startEvent === node
    : (node) => isNoneStartEvent(node);

  return element.children.filter(
    node => (
      isStartEvent(node) || isImplicitStartEvent(node)
    )
  );
};

StudyBehavior.$inject = [
  'simulator',
  'scopeBehavior'
];