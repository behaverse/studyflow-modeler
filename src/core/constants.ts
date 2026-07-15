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
  { prefix: 'exec', name: 'Exec', description: 'The executable layer: step contract, scopes, artifacts.', core: true },
  { prefix: 'cognitive', name: 'Cognitive', description: 'Cognitive and behavioral research elements.', core: true },
  { prefix: 'behaverse', name: 'Behaverse', description: 'Cognitive tasks (Behaverse assessments).' },
  { prefix: 'ml', name: 'ML', description: 'Statistical and machine-learning pipelines: the Model and Metric artifacts, plus a generic Operation step that verb templates bind a function onto — one fitting notation from classical estimators and formulas to fine-tuning and prompt optimization.' },
  { prefix: 'agentic', name: 'Agentic', description: 'LLM and agent workflows: agents, model-driven routing, model/tool calls, human approval, and prompt/memory artifacts.' },
  { prefix: 'datatrove', name: 'DataTrove', description: 'Function-composition operations over data streams, plus the DataTrove read/write/corpus family.' },
  { prefix: 'omniprocess', name: 'OmniProcess', description: 'Brain and brain-data processing (fMRIPrep, EEGPrep).' },
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
  ChoreographyTask: 'bpmn:ChoreographyTask',
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
