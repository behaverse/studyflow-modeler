/**
 * Single source of constants.
 *
 */

// --- 1. Schemas

export type SchemaDescriptor = {
  /** prefix (matches the schema's `prefix` field). */
  prefix: string;
  /** Display name shown in UI. */
  name: string;
  /** summary shown in the settings page. */
  description: string;
  /** Core schemas back default elements (Study, StartEvent, EndEvent). Disabling a core schema may break the modeler. */
  core?: boolean;
};

export const SCHEMAS: SchemaDescriptor[] = [
  {
    prefix: 'studyflow',
    name: 'Studyflow',
    description: 'BPMN extension for modeling cognitive research.',
    core: true,
  },
  {
    prefix: 'behaverse',
    name: 'Behaverse',
    description: 'Cognitive tasks (Behaverse assessments).',
  },
  {
    prefix: 'omniprocess',
    name: 'OmniProcess',
    description: 'A library of data processing elements for multimodal cognitive neuroscience.',
  },
  {
    prefix: 'datatrove',
    name: 'DataTrove',
    description: 'Data transformation activities for the DataTrove ecosystem.',
  },
  {
    prefix: 'galea',
    name: 'Galea',
    description: 'Experimental elements for the OpenBCI Galea VR headset (donning, sensor calibration, recording, etc).',
  },
];

export const SCHEMA_NAMES = SCHEMAS.map((s) => s.prefix);

export const NAMESPACES = {
  bpmn: 'http://www.omg.org/spec/BPMN/20100524/MODEL',
  studyflow: 'http://behaverse.org/schemas/studyflow',
} as const;

// --- 2. BPMN element types

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

/** Schema types that are excluded from palette . */
export const HIDDEN_SCHEMA_TYPES = new Set(['Study', 'StartEvent', 'EndEvent', 'SequenceFlow']);

/** primitive type names used to filter out non-instantiable schema types. */
export const PRIMITIVE_MODDLE_TYPES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

// --- 3. Palette

export type PaletteEntry = {
  label: string;
  bpmnType: string;
  studyflowType?: string;
  icon?: string;
};

export type PaletteGroup = {
  label: string;
  icon: string;
  items: PaletteEntry[];
};

/**
 * Default palette groups. Schemas contribute extra entries at
 * runtime via the `palette-register-schema-providers` command; those get
 * merged into these groups.
 */
export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    label: 'Events',
    icon: 'iconify fluent--circle-16-regular',
    items: [
      { label: 'Start', bpmnType: BPMN.StartEvent, studyflowType: 'studyflow:StartEvent', icon: 'iconify bpmn--start-event-none' },
      { label: 'Intermediate', bpmnType: BPMN.IntermediateThrowEvent, icon: 'iconify bpmn--intermediate-event-none' },
      { label: 'End', bpmnType: BPMN.EndEvent, studyflowType: 'studyflow:EndEvent', icon: 'iconify bpmn--end-event-none' },
    ],
  },
  {
    label: 'Activities',
    icon: 'iconify fluent--square-16-regular',
    items: [
      { label: 'Task', bpmnType: BPMN.Task, icon: 'iconify bpmn--task-none' },
      { label: 'User', bpmnType: BPMN.UserTask, icon: 'iconify bpmn--user-task' },
      { label: 'Script', bpmnType: BPMN.ScriptTask, icon: 'iconify bpmn--script-task' },
      { label: 'Service', bpmnType: BPMN.ServiceTask, icon: 'iconify bpmn--service-task' },
      { label: 'Manual', bpmnType: BPMN.ManualTask, icon: 'iconify bpmn--manual-task' },
    ],
  },
  {
    label: 'Gateways',
    icon: 'iconify fluent--diamond-16-regular',
    items: [
      { label: 'Exclusive', bpmnType: BPMN.ExclusiveGateway, icon: 'iconify bpmn--gateway-xor' },
      { label: 'Parallel', bpmnType: BPMN.ParallelGateway, icon: 'iconify bpmn--gateway-parallel' },
      { label: 'Inclusive', bpmnType: BPMN.InclusiveGateway, icon: 'iconify bpmn--gateway-or' },
      { label: 'Complex', bpmnType: BPMN.ComplexGateway, icon: 'iconify bpmn--gateway-complex' },
      { label: 'Event Based', bpmnType: BPMN.EventBasedGateway, icon: 'iconify bpmn--gateway-eventbased' },
    ],
  },
  {
    label: 'Data',
    icon: 'iconify fluent--database-16-regular',
    items: [
      { label: 'Data Object', bpmnType: BPMN.DataObjectReference, icon: 'iconify bpmn--data-object' },
    ],
  },
  {
    label: 'Containers',
    icon: 'iconify mynaui--square-dashed',
    items: [
      { label: 'Group', bpmnType: BPMN.Group, icon: 'iconify bpmn--group' },
      { label: 'SubProcess', bpmnType: BPMN.SubProcess, icon: 'iconify bpmn--subprocess-collapsed' },
      { label: 'Pool', bpmnType: BPMN.Participant, icon: 'iconify bpmn--participant' },
    ],
  },
];

// --- 4. Persistence

/** localStorage key for user-level modeler settings (theme / language / etc.). */
export const SETTINGS_STORAGE_KEY = 'studyflow-modeler:settings:v1';

// --- 5. File handling

/** Accepted file extensions when opening a diagram from disk. */
export const VALID_FILE_EXTENSIONS = ['.xml', '.svg', '.studyflow'];

// --- 6. External URLs

export const URLS = {
  githubRepo: 'https://github.com/behaverse/studyflow-modeler',
  githubOrg: 'https://github.com/behaverse',
  apiBase: 'https://api.behaverse.org',
  apiDocs: 'https://api.behaverse.org/docs',
  docs: './docs',
} as const;

// --- 7. Renderer icon assets

/**
 * Inline SVG path data for icons that must survive SVG export.
 * CSS-based icons (mask-image, background-image) are lost during export
 * because foreignObject content is not self-contained.
 */
export const SVG_ICON_PATHS: Record<string, { viewBox: string; paths: string[] }> = {
  'bids-dataset-icon': {
    viewBox: '0 0 135 43.461',
    paths: [
      'm29.99,21.107l-0.961,-0.458l0.814,-0.702a10.755,10.755 0 0 0 3.827,-8.452c0,-6.731 -4.513,-10.019 -13.782,-10.019l-18.051,0l0,40.517l17.542,0c5.843,0 15.644,-1.525 15.644,-11.747c0.013,-4.535 -1.638,-7.519 -5.032,-9.138m-11.673,-12.353c5.048,0 7.106,1.404 7.106,4.836c0,1.282 -0.616,4.231 -6.33,4.231l-9.388,0l0,-6.919l-4.993,-2.148l13.605,0zm0.116,25.961l-8.727,0l0,-9.903l9.208,0c3.872,0 7.83,0.58 7.83,4.891c0.007,4.398 -3.993,5 -8.311,5l0,0.012z',
      'm42.724,1.476l7.875,0l0,40.506l-7.875,0l0,-40.506z',
      'm72.676,1.476l-12.593,0l0,40.516l11.692,0c8.195,0 14.356,-1.949 18.311,-5.789s6.009,-8.866 6.009,-15.003c0.003,-7.372 -3.039,-19.725 -23.42,-19.725m-0.122,33.227l-4.59,0l0,-23.627l-5.638,-2.321l10.237,0c10.202,0 15.384,4.167 15.384,12.436c-0.019,8.971 -5.192,13.513 -15.394,13.513',
      'm133.16,30.351a10.255,10.255 0 0 0 -1.602,-5.715c-2.144,-3.132 -5.324,-4.394 -9.58,-5.833c-1.509,-0.513 -3.007,-0.914 -4.455,-1.298c-4.128,-1.1 -7.692,-2.048 -7.692,-5.055c0,-2.122 1.211,-4.654 6.987,-4.654c4.003,0 7.465,1.548 10.577,4.734l5.227,-5.058c-3.75,-4.676 -8.817,-6.952 -15.465,-6.952c-4.596,0 -8.372,1.211 -11.218,3.606s-4.301,5.128 -4.301,8.442c0,7.138 5.375,9.766 11.18,11.539c1.417,0.477 2.734,0.836 4.007,1.186c2.414,0.664 4.487,1.234 6.116,2.311c1.308,0.872 2.058,2.134 2.058,3.465s-0.705,2.513 -1.923,3.333c-1.164,0.84 -2.904,1.253 -5.301,1.253c-5.009,0 -9.542,-2.481 -12.548,-6.843l-5.718,4.763c3.356,5.961 10.064,9.366 18.507,9.366c4.384,0 7.936,-1.199 10.862,-3.667c2.84,-2.352 4.285,-5.352 4.285,-8.923',
    ],
  },
};

/**
 * Custom icon overrides for standard BPMN elements.
 * Maps BPMN element / marker names to iconify class strings.
 */
export const BPMN_ICON_OVERRIDES: Record<string, string> = {
  'bpmn:ManualTask':        'iconify fluent--hand-left-24-regular rotate-90',
  'bpmn:UserTask':          'iconify bi--person',
  'bpmn:ServiceTask':       'iconify mdi--cog-outline',
  'bpmn:ScriptTask':        'iconify fluent--script-24-regular',
  'bpmn:SendTask':          'iconify bi--envelope-fill !ms-[2px] !w-5 !h-5',
  'bpmn:ReceiveTask':       'iconify bi--envelope-open !ms-[2px] !w-5 !h-5',
  'bpmn:BusinessRuleTask':  'iconify mdi--table',
  'bpmn:ExclusiveGateway':  'iconify mdi--close',
  'bpmn:ParallelGateway':   'iconify mdi--plus',
  'bpmn:InclusiveGateway':  'iconify mdi--checkbox-blank-circle-outline',
  'bpmn:ComplexGateway':    'iconify mdi--asterisk',
  'bpmn:EventBasedGateway': 'iconify mdi--pentagon-outline',
  'operation':              'iconify mdi--function',
  'subprocess':             'iconify mdi--plus-box-outline',
  'adhoc':                  'iconify tabler--tilde',
  'parallel':               'iconify solar--hamburger-menu-linear rotate-90',
  'sequential':             'iconify solar--hamburger-menu-linear',
  'loop':                   'iconify mdi--loop',
  'compensation':           'iconify bpmn--compensation-marker',
  'checklist':              'iconify mdi--checkbox-outline',
};
