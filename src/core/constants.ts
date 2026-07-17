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
  { prefix: 'exec', name: 'Exec', description: 'The minimal executable layer: the implementation reference, loop/sensor flattenings, artifact uri, and Parameters — just enough for a Python engine to run a diagram.', core: true },
  { prefix: 'functional', name: 'Functional', description: 'The functional-programming vocabulary: transform, map, reduce, and filter over data, plus the fan-out behind the multi-instance marker — the generic anchors domain schemas bind their verbs onto.', core: true },
  { prefix: 'cognitive', name: 'Cognitive', description: 'Cognitive and behavioral research elements, including Behaverse assessment tasks.', core: true },
  { prefix: 'ml', name: 'ML', description: 'Statistical and machine-learning pipelines as presets over the datatrove data operations — no element types; loading is a Reader, PCA a Map, fitting and scoring a Reduce, saving a Writer, each bound to a function via `implementation`.' },
  { prefix: 'agentic', name: 'Agentic', description: 'LLM and agent workflows: agents, model-driven routing, model/tool calls, human approval, and prompt/memory artifacts.' },
  { prefix: 'datatrove', name: 'DataTrove', description: 'The datatrove library\'s own pipeline blocks: Reader/Writer IO steps and presets over its processing blocks.' },
  { prefix: 'omniprocess', name: 'OmniProcess', description: 'Brain and brain-data processing (fMRIPrep, EEGPrep).' },
  { prefix: 'openbci', name: 'OpenBCI', description: 'Biosignal acquisition with OpenBCI boards (Cyton, Ganglion, Galea VR headset).' },
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
