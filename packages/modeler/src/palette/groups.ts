import { BPMN } from '@core/constants';
import { BPMN_ICON_OVERRIDES } from '@modeler/draw/icons';
import { ICONS } from '@modeler/icons';

export type PaletteEntry = {
  label: string;
  bpmnType: string;
  extensionType?: string;
  icon?: string;
  /** Business-object properties the variant needs (`eventDefinitions` for a timer start). */
  attributes?: Record<string, unknown>;
};

const def = (type: string) => ({ eventDefinitions: [{ type: `bpmn:${type}EventDefinition` }] });

export type PaletteGroup = {
  label: string;
  icon: string;
  items: PaletteEntry[];
};

export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    label: 'Events',
    icon: ICONS.circle,
    items: [
      { label: 'Start', bpmnType: BPMN.StartEvent, extensionType: 'studyflow:StartEvent', icon: ICONS.bpmnStartEvent },
      { label: 'Timer Start', bpmnType: BPMN.StartEvent, extensionType: 'studyflow:StartEvent', icon: 'iconify bpmn--start-event-timer', attributes: def('Timer') },
      { label: 'Message Start', bpmnType: BPMN.StartEvent, extensionType: 'studyflow:StartEvent', icon: 'iconify bpmn--start-event-message', attributes: def('Message') },
      { label: 'Conditional Start', bpmnType: BPMN.StartEvent, extensionType: 'studyflow:StartEvent', icon: 'iconify bpmn--start-event-condition', attributes: def('Conditional') },
      { label: 'Intermediate', bpmnType: BPMN.IntermediateThrowEvent, icon: ICONS.bpmnIntermediateEvent },
      { label: 'Timer Catch', bpmnType: BPMN.IntermediateCatchEvent, icon: 'iconify bpmn--intermediate-event-catch-timer', attributes: def('Timer') },
      { label: 'Message Catch', bpmnType: BPMN.IntermediateCatchEvent, icon: 'iconify bpmn--intermediate-event-catch-message', attributes: def('Message') },
      { label: 'Conditional Catch', bpmnType: BPMN.IntermediateCatchEvent, icon: 'iconify bpmn--intermediate-event-catch-condition', attributes: def('Conditional') },
      { label: 'Message Throw', bpmnType: BPMN.IntermediateThrowEvent, icon: 'iconify bpmn--intermediate-event-throw-message', attributes: def('Message') },
      { label: 'Error Boundary', bpmnType: BPMN.BoundaryEvent, icon: 'iconify bpmn--intermediate-event-catch-error', attributes: def('Error') },
      { label: 'Timer Boundary', bpmnType: BPMN.BoundaryEvent, icon: 'iconify bpmn--intermediate-event-catch-timer', attributes: def('Timer') },
      { label: 'Message Boundary', bpmnType: BPMN.BoundaryEvent, icon: 'iconify bpmn--intermediate-event-catch-message', attributes: def('Message') },
      { label: 'End', bpmnType: BPMN.EndEvent, extensionType: 'studyflow:EndEvent', icon: ICONS.bpmnEndEvent },
      { label: 'Error End', bpmnType: BPMN.EndEvent, extensionType: 'studyflow:EndEvent', icon: 'iconify bpmn--end-event-error', attributes: def('Error') },
      { label: 'Terminate End', bpmnType: BPMN.EndEvent, extensionType: 'studyflow:EndEvent', icon: 'iconify bpmn--end-event-terminate', attributes: def('Terminate') },
    ],
  },
  {
    label: 'Activities',
    icon: ICONS.square,
    items: [
      { label: 'Task', bpmnType: BPMN.Task, icon: ICONS.square },
      { label: 'User', bpmnType: BPMN.UserTask, icon: BPMN_ICON_OVERRIDES[BPMN.UserTask] },
      { label: 'Script', bpmnType: BPMN.ScriptTask, icon: BPMN_ICON_OVERRIDES[BPMN.ScriptTask] },
      { label: 'Service', bpmnType: BPMN.ServiceTask, icon: BPMN_ICON_OVERRIDES[BPMN.ServiceTask] },
      { label: 'Manual', bpmnType: BPMN.ManualTask, icon: BPMN_ICON_OVERRIDES[BPMN.ManualTask] },
      { label: 'Choreography Task', bpmnType: BPMN.ChoreographyTask, icon: ICONS.peopleTeam },
    ],
  },
  {
    label: 'Gateways',
    icon: ICONS.diamond,
    items: [
      { label: 'Exclusive', bpmnType: BPMN.ExclusiveGateway, icon: ICONS.bpmnGatewayXor },
      { label: 'Parallel', bpmnType: BPMN.ParallelGateway, icon: ICONS.bpmnGatewayParallel },
      { label: 'Inclusive', bpmnType: BPMN.InclusiveGateway, icon: ICONS.bpmnGatewayOr },
      { label: 'Complex', bpmnType: BPMN.ComplexGateway, icon: ICONS.bpmnGatewayComplex },
      { label: 'Event-based', bpmnType: BPMN.EventBasedGateway, icon: ICONS.bpmnGatewayEventBased },
    ],
  },
  {
    label: 'Data',
    icon: ICONS.database,
    items: [
      { label: 'Data Object', bpmnType: BPMN.DataObjectReference, icon: ICONS.document },
    ],
  },
  {
    label: 'Containers',
    icon: ICONS.squareDashed,
    items: [
      { label: 'Group', bpmnType: BPMN.Group, icon: ICONS.bpmnGroup },
      { label: 'Sub-process', bpmnType: BPMN.SubProcess, icon: ICONS.bpmnSubprocess },
      { label: 'Pool', bpmnType: BPMN.Participant, icon: ICONS.bpmnParticipant },
    ],
  },
];

/** Derived from the groups above, not restated, so the two cannot drift. Variants (a timer start) do not speak for their type. */
export const PALETTE_BPMN_ICONS: Record<string, string> = Object.fromEntries(
  PALETTE_GROUPS.flatMap((group) =>
    group.items
      .filter((item): item is PaletteEntry & { icon: string } => !!item.icon && !item.attributes)
      .map((item) => [item.bpmnType, item.icon] as const)
  )
);

export function getPaletteIconForBpmnType(bpmnType: string | undefined): string | undefined {
  if (!bpmnType) return undefined;
  return PALETTE_BPMN_ICONS[bpmnType] ?? BPMN_ICON_OVERRIDES[bpmnType];
}
