/**
 * Core studyflow namespace; the version segment identifies the studyflow
 * format version. Must match `uri` in `assets/schemas/studyflow.moddle.yaml`.
 */
export const STUDYFLOW_NS = 'http://behaverse.org/schemas/studyflow/v1';

/** Unversioned namespace written by older releases; rewritten to `STUDYFLOW_NS` on load. */
export const LEGACY_STUDYFLOW_NS = 'http://behaverse.org/schemas/studyflow';

type Schema = {
  prefix: string;
  name: string;
  description: string;
  /** Core schemas back the default elements (always loaded). */
  core?: boolean;
};

export const SCHEMAS: Schema[] = [
  { prefix: 'studyflow', name: 'Core', description: 'Generic research elements and data infrastructure.', core: true },
  { prefix: 'cognitive', name: 'Cognitive', description: 'Cognitive and behavioral research elements.', core: true },
  { prefix: 'behaverse', name: 'Behaverse', description: 'Cognitive tasks (Behaverse assessments).' },
  { prefix: 'omniprocess', name: 'OmniProcess', description: 'Data processing elements for multimodal cognitive neuroscience.' },
  { prefix: 'datatrove', name: 'DataTrove', description: 'Data transformation elements for the DataTrove ecosystem.' },
  { prefix: 'galea', name: 'Galea', description: 'Experimental elements for the OpenBCI Galea VR headset.' },
];

export const SCHEMA_NAMES = SCHEMAS.map((s) => s.prefix);

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

export const CORE_PREFIXES = new Set(['bpmn', 'bpmndi', 'dc', 'di', 'xsi', 'xml']);
