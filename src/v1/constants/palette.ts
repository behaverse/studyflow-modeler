import { BPMN } from './bpmn';

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
 * Default BPMN-only palette groups. Schemas contribute extra entries at
 * runtime via the `palette-register-schema-providers` command; those get
 * merged into these groups by `categories[0]`.
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
    icon: 'iconify fluent--rectangle-landscape-16-regular',
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
      { label: 'Event', bpmnType: BPMN.EventBasedGateway, icon: 'iconify bpmn--gateway-eventbased' },
    ],
  },
  {
    label: 'Data',
    icon: 'iconify mynaui--database',
    items: [
      { label: 'Data Object', bpmnType: BPMN.DataObjectReference, icon: 'iconify bpmn--data-object' },
    ],
  },
  {
    label: 'Containers',
    icon: 'iconify mynaui--square-dashed',
    items: [
      { label: 'Group', bpmnType: BPMN.Group, icon: 'iconify bpmn--group' },
      { label: 'Sub-Process', bpmnType: BPMN.SubProcess, icon: 'iconify bpmn--subprocess-collapsed' },
      { label: 'Pool', bpmnType: BPMN.Participant, icon: 'iconify bpmn--participant' },
    ],
  },
];
