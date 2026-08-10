/** Static slice of the BPMN 2.0 metamodel: each chain is most-derived first and excludes the type itself. */
export const BPMN_ANCESTORS: Record<string, string[]> = {
  'bpmn:Task': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:UserTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ServiceTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ScriptTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ManualTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:SendTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ReceiveTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:BusinessRuleTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:CallActivity': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ChoreographyTask': ['bpmn:ChoreographyActivity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:SubProcess': ['bpmn:Activity', 'bpmn:FlowElementsContainer', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Transaction': ['bpmn:SubProcess', 'bpmn:Activity', 'bpmn:FlowElementsContainer', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:AdHocSubProcess': ['bpmn:SubProcess', 'bpmn:Activity', 'bpmn:FlowElementsContainer', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],

  'bpmn:StartEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:EndEvent': ['bpmn:ThrowEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:IntermediateThrowEvent': ['bpmn:ThrowEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:IntermediateCatchEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:BoundaryEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],

  'bpmn:ExclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ParallelGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:InclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ComplexGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:EventBasedGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],

  'bpmn:DataObjectReference': ['bpmn:FlowElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],
  'bpmn:DataStoreReference': ['bpmn:FlowElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],
  'bpmn:DataObject': ['bpmn:FlowElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],
  'bpmn:DataStore': ['bpmn:RootElement', 'bpmn:ItemAwareElement', 'bpmn:BaseElement'],

  'bpmn:Documentation': ['bpmn:BaseElement'],
  'bpmn:DataState': ['bpmn:BaseElement'],
  'bpmn:Property': ['bpmn:ItemAwareElement', 'bpmn:BaseElement'],
  'bpmn:StandardLoopCharacteristics': ['bpmn:LoopCharacteristics', 'bpmn:BaseElement'],
  'bpmn:MultiInstanceLoopCharacteristics': ['bpmn:LoopCharacteristics', 'bpmn:BaseElement'],
  'bpmn:LoopCharacteristics': ['bpmn:BaseElement'],
  'bpmn:ConditionalEventDefinition': ['bpmn:EventDefinition', 'bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:TimerEventDefinition': ['bpmn:EventDefinition', 'bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:EventDefinition': ['bpmn:RootElement', 'bpmn:BaseElement'],

  'bpmn:SequenceFlow': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:MessageFlow': ['bpmn:BaseElement'],
  'bpmn:Association': ['bpmn:Artifact', 'bpmn:BaseElement'],
  'bpmn:Participant': ['bpmn:BaseElement'],
  'bpmn:Lane': ['bpmn:BaseElement'],
  'bpmn:Group': ['bpmn:Artifact', 'bpmn:BaseElement'],
  'bpmn:TextAnnotation': ['bpmn:Artifact', 'bpmn:BaseElement'],
  'bpmn:Process': ['bpmn:FlowElementsContainer', 'bpmn:CallableElement', 'bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:Collaboration': ['bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:Choreography': ['bpmn:Collaboration', 'bpmn:FlowElementsContainer', 'bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:Expression': ['bpmn:BaseElement'],
  'bpmn:FormalExpression': ['bpmn:Expression', 'bpmn:BaseElement'],

  'bpmn:Activity': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ChoreographyActivity': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
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

export function bpmnSelfAndAncestors(type: string): string[] {
  const chain = BPMN_ANCESTORS[type];
  return chain ? [type, ...chain] : [type];
}

export function isBpmnSubtypeOf(type: string, ancestor: string): boolean {
  return type === ancestor || (BPMN_ANCESTORS[type] ?? []).includes(ancestor);
}
