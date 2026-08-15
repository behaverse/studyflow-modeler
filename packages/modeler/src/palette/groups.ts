import { BPMN } from '@core/constants';
import { BPMN_ICON_OVERRIDES } from '@modeler/draw/icons';
import { ICONS } from '@modeler/icons';

export type PaletteEntry = {
  label: string;
  bpmnType: string;
  extensionType?: string;
  icon?: string;
};

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
      { label: 'Intermediate', bpmnType: BPMN.IntermediateThrowEvent, icon: ICONS.bpmnIntermediateEvent },
      { label: 'End', bpmnType: BPMN.EndEvent, extensionType: 'studyflow:EndEvent', icon: ICONS.bpmnEndEvent },
    ],
  },
  {
    label: 'Activities',
    icon: ICONS.square,
    items: [
      { label: 'Task', bpmnType: BPMN.Task, icon: ICONS.bpmnTask },
      { label: 'User', bpmnType: BPMN.UserTask, icon: ICONS.bpmnUserTask },
      { label: 'Script', bpmnType: BPMN.ScriptTask, icon: ICONS.bpmnScriptTask },
      { label: 'Service', bpmnType: BPMN.ServiceTask, icon: ICONS.bpmnServiceTask },
      { label: 'Manual', bpmnType: BPMN.ManualTask, icon: ICONS.bpmnManualTask },
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

/** Derived from the groups above, not restated, so the two cannot drift. */
export const PALETTE_BPMN_ICONS: Record<string, string> = Object.fromEntries(
  PALETTE_GROUPS.flatMap((group) =>
    group.items
      .filter((item): item is PaletteEntry & { icon: string } => !!item.icon)
      .map((item) => [item.bpmnType, item.icon] as const)
  )
);

export function getPaletteIconForBpmnType(bpmnType: string | undefined): string | undefined {
  if (!bpmnType) return undefined;
  return PALETTE_BPMN_ICONS[bpmnType] ?? BPMN_ICON_OVERRIDES[bpmnType];
}
