/**
 * BPMN built-in properties that already exist on base BPMN types.
 * When a studyflow extends-type re-declares one of these, moddle requires
 * a `redefines` pointing at the original owner.
 */
export const BPMN_REDEFINES: Record<string, string> = {
  documentation: 'bpmn:BaseElement#documentation',
  name: 'bpmn:FlowElement#name',
  conditionExpression: 'bpmn:SequenceFlow#conditionExpression'
};

/**
 * BPMN type hierarchy — maps each BPMN type to its ancestor types.
 */
export const BPMN_ANCESTORS: Record<string, string[]> = {
  'bpmn:Task': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:UserTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:SubProcess': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:StartEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:EndEvent': ['bpmn:ThrowEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ExclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ParallelGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:InclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:DataStoreReference': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:DataStore': ['bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:DataObject': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:DataObjectReference': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Process': ['bpmn:FlowElementsContainer', 'bpmn:CallableElement', 'bpmn:BaseElement'],
  'bpmn:Activity': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:BaseElement': [],
  'bpmn:Event': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Gateway': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement']
};

/**
 * Global class -> BPMN mapping cache shared across converter instances.
 */
export const GLOBAL_BPMN_MAPPINGS: Map<string, string> = new Map();
