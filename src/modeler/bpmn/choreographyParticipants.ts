import { DEFAULT_BOTTOM, DEFAULT_TOP } from '@behaverse/studyflow-core/document';

function definitionsOf(bo: any): any {
  while (bo && bo.$type !== 'bpmn:Definitions') bo = bo.$parent;
  return bo;
}

function participantHolder(definitions: any): any {
  return (definitions?.get('rootElements') ?? []).find((re: any) => re.$type === 'bpmn:Collaboration');
}

/** The collaboration is created with no DI plane, so participants live in the XML without drawing on the canvas. */
export function ensureChoreographyParticipants(element: any, modeling: any, bpmnFactory: any): [any, any] {
  const bo = element.businessObject;
  const refs: any[] = bo.get('participantRef') ?? [];
  if (refs.length >= 2) return [refs[0], refs[1]];

  const definitions = definitionsOf(bo);
  const top = refs[0] ?? bpmnFactory.create('bpmn:Participant', { name: DEFAULT_TOP });
  const bottom = refs[1] ?? bpmnFactory.create('bpmn:Participant', { name: DEFAULT_BOTTOM });
  const fresh = [top, bottom].filter((_p, i) => !refs[i]);

  let collaboration = participantHolder(definitions);
  if (!collaboration) {
    collaboration = bpmnFactory.create('bpmn:Collaboration', { participants: [] });
    collaboration.$parent = definitions;
    modeling.updateModdleProperties(element, definitions, {
      rootElements: [...(definitions.get('rootElements') ?? []), collaboration],
    });
  }
  for (const p of fresh) p.$parent = collaboration;
  modeling.updateModdleProperties(element, collaboration, {
    participants: [...(collaboration.get('participants') ?? []), ...fresh],
  });
  modeling.updateModdleProperties(element, bo, {
    participantRef: [top, bottom],
    initiatingParticipantRef: bo.get('initiatingParticipantRef') ?? top,
  });
  return [top, bottom];
}

export function swapChoreographyInitiator(element: any, modeling: any, bpmnFactory: any): void {
  const bo = element.businessObject;
  const [top, bottom] = ensureChoreographyParticipants(element, modeling, bpmnFactory);
  const initiating = bo.get('initiatingParticipantRef');
  modeling.updateModdleProperties(element, bo, {
    initiatingParticipantRef: initiating === top ? bottom : top,
  });
}
