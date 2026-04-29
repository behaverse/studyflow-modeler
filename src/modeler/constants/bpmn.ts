export const BPMN = {
  Task: 'bpmn:Task',
  UserTask: 'bpmn:UserTask',
  ScriptTask: 'bpmn:ScriptTask',
  ServiceTask: 'bpmn:ServiceTask',
  ManualTask: 'bpmn:ManualTask',
  SendTask: 'bpmn:SendTask',
  ReceiveTask: 'bpmn:ReceiveTask',
  BusinessRuleTask: 'bpmn:BusinessRuleTask',
  CallActivity: 'bpmn:CallActivity',
  SubProcess: 'bpmn:SubProcess',
  Activity: 'bpmn:Activity',

  StartEvent: 'bpmn:StartEvent',
  EndEvent: 'bpmn:EndEvent',
  IntermediateThrowEvent: 'bpmn:IntermediateThrowEvent',
  IntermediateCatchEvent: 'bpmn:IntermediateCatchEvent',
  BoundaryEvent: 'bpmn:BoundaryEvent',
  Event: 'bpmn:Event',

  ExclusiveGateway: 'bpmn:ExclusiveGateway',
  ParallelGateway: 'bpmn:ParallelGateway',
  InclusiveGateway: 'bpmn:InclusiveGateway',
  ComplexGateway: 'bpmn:ComplexGateway',
  EventBasedGateway: 'bpmn:EventBasedGateway',
  Gateway: 'bpmn:Gateway',

  DataObjectReference: 'bpmn:DataObjectReference',
  DataStoreReference: 'bpmn:DataStoreReference',
  DataObject: 'bpmn:DataObject',
  DataStore: 'bpmn:DataStore',

  SequenceFlow: 'bpmn:SequenceFlow',
  MessageFlow: 'bpmn:MessageFlow',
  Association: 'bpmn:Association',

  Participant: 'bpmn:Participant',
  Lane: 'bpmn:Lane',
  Group: 'bpmn:Group',
  TextAnnotation: 'bpmn:TextAnnotation',

  Process: 'bpmn:Process',
  Collaboration: 'bpmn:Collaboration',
  Definitions: 'bpmn:Definitions',
  ExtensionElements: 'bpmn:ExtensionElements',

  FlowElement: 'bpmn:FlowElement',
  FlowNode: 'bpmn:FlowNode',
  RootElement: 'bpmn:RootElement',
} as const;

export type BpmnTypeString = typeof BPMN[keyof typeof BPMN];

export const CORE_PREFIXES = new Set([
  'bpmn',
  'bpmndi',
  'dc',
  'di',
  'xsi',
  'xml',
]);
