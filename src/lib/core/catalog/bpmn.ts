/**
 * Static slice of the BPMN 2.0 metamodel: ancestor chains (most-derived first,
 * excluding self) for every BPMN type the schemas, palette, and renderer refer
 * to. BPMN 2.0 has been frozen since 2011, so this table replaces runtime
 * moddle reflection; `tests/catalog.unit.spec.ts` cross-checks it against
 * bpmn-moddle so it cannot drift silently.
 */
export const BPMN_ANCESTORS: Record<string, string[]> = {
  // Activities
  'bpmn:Task': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:UserTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ServiceTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ScriptTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ManualTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:SendTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ReceiveTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:BusinessRuleTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:CallActivity': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:SubProcess': ['bpmn:Activity', 'bpmn:FlowElementsContainer', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Transaction': ['bpmn:SubProcess', 'bpmn:Activity', 'bpmn:FlowElementsContainer', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:AdHocSubProcess': ['bpmn:SubProcess', 'bpmn:Activity', 'bpmn:FlowElementsContainer', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],

  // Events
  'bpmn:StartEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:EndEvent': ['bpmn:ThrowEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:IntermediateThrowEvent': ['bpmn:ThrowEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:IntermediateCatchEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:BoundaryEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],

  // Gateways
  'bpmn:ExclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ParallelGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:InclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ComplexGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:EventBasedGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],

  // Data
  'bpmn:DataObjectReference': ['bpmn:FlowElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],
  'bpmn:DataStoreReference': ['bpmn:FlowElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],
  'bpmn:DataObject': ['bpmn:FlowElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],
  'bpmn:DataStore': ['bpmn:RootElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],

  // Connections, containers, misc
  'bpmn:SequenceFlow': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:MessageFlow': ['bpmn:BaseElement'],
  'bpmn:Association': ['bpmn:Artifact', 'bpmn:BaseElement'],
  'bpmn:Participant': ['bpmn:BaseElement'],
  'bpmn:Lane': ['bpmn:BaseElement'],
  'bpmn:Group': ['bpmn:Artifact', 'bpmn:BaseElement'],
  'bpmn:TextAnnotation': ['bpmn:Artifact', 'bpmn:BaseElement'],
  'bpmn:Process': ['bpmn:FlowElementsContainer', 'bpmn:CallableElement', 'bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:Collaboration': ['bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:Expression': ['bpmn:BaseElement'],
  'bpmn:FormalExpression': ['bpmn:Expression', 'bpmn:BaseElement'],

  // Abstract bases
  'bpmn:Activity': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:CatchEvent': ['bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ThrowEvent': ['bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Event': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Gateway': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:FlowNode': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:FlowElement': ['bpmn:BaseElement'],
  'bpmn:FlowElementsContainer': ['bpmn:BaseElement'],
  'bpmn:ItemAwareElement': ['bpmn:BaseElement'],
  'bpmn:Artifact': ['bpmn:BaseElement'],
  'bpmn:CallableElement': ['bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:RootElement': ['bpmn:BaseElement'],
  'bpmn:BaseElement': [],
};

/** `type` followed by its ancestors, most-derived first. */
export function bpmnSelfAndAncestors(type: string): string[] {
  const chain = BPMN_ANCESTORS[type];
  return chain ? [type, ...chain] : [type];
}

export function isBpmnSubtypeOf(type: string, ancestor: string): boolean {
  return type === ancestor || (BPMN_ANCESTORS[type] ?? []).includes(ancestor);
}
