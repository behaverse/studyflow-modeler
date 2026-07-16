import { BPMN } from '@/core/constants';
import { ICONS } from '@/icons';
export { SCHEMAS, SCHEMA_NAMES, BPMN } from '@/core/constants';

export const NAMESPACES = {
  bpmn: 'http://www.omg.org/spec/BPMN/20100524/MODEL',
  // Unversioned legacy namespace, as declared in the bundled XML examples
  // (the current versioned URI lives in `core/constants.ts`).
  core: 'http://behaverse.org/schemas/studyflow',
  cognitive: 'http://behaverse.org/schemas/studyflow/cognitive',
} as const;

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

/** Default palette groups; schemas merge extra entries via `resolve-palette-schemas`. */
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
      { label: 'Event Based', bpmnType: BPMN.EventBasedGateway, icon: ICONS.bpmnGatewayEventBased },
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
      { label: 'SubProcess', bpmnType: BPMN.SubProcess, icon: ICONS.bpmnSubprocess },
      { label: 'Pool', bpmnType: BPMN.Participant, icon: ICONS.bpmnParticipant },
    ],
  },
];

export const SETTINGS_STORAGE_KEY = 'studyflow-modeler:settings:v1';
export const AUTOSAVE_DIAGRAM_STORAGE_KEY = 'studyflow-modeler:autosave-diagram:v1';

export const VALID_FILE_EXTENSIONS = ['.xml', '.bpmn', '.svg', '.png', '.studyflow'];

export const URLS = {
  githubRepo: 'https://github.com/behaverse/studyflow-modeler',
  apiBase: 'https://api.behaverse.org',
  apiDocs: 'https://api.behaverse.org/docs',
  docs: './docs',
} as const;

/** Inline SVG paths for icons that must survive SVG export (CSS icons don't). */
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

/** Iconify class overrides keyed by BPMN type or marker name. */
export const BPMN_ICON_OVERRIDES: Record<string, string> = {
  'bpmn:ManualTask':        `${ICONS.handLeft} rotate-90`,
  'bpmn:UserTask':          ICONS.person,
  'bpmn:ServiceTask':       ICONS.cog,
  'bpmn:ScriptTask':        ICONS.script,
  'bpmn:SendTask':          `${ICONS.envelope} !ms-[2px] !w-5 !h-5`,
  'bpmn:ReceiveTask':       `${ICONS.envelopeOpen} !ms-[2px] !w-5 !h-5`,
  'bpmn:BusinessRuleTask':  ICONS.tableAlt,
  'bpmn:ExclusiveGateway':  ICONS.closeAlt,
  'bpmn:ParallelGateway':   ICONS.plusAlt,
  'bpmn:InclusiveGateway':  ICONS.radioBlank,
  'bpmn:ComplexGateway':    ICONS.asterisk,
  'bpmn:EventBasedGateway': ICONS.pentagon,
  'bpmn:DataObjectReference': ICONS.document,
  'subprocess':             ICONS.plusBox,
  'adhoc':                  ICONS.tilde,
  'parallel':               `${ICONS.menu} rotate-90`,
  'sequential':             ICONS.menu,
  'loop':                   ICONS.loop,
  'compensation':           ICONS.bpmnCompensationMarker,
  'checklist':              ICONS.checkbox,
  'function':               ICONS.function,
};

/** Icon lookup by bpmnType, sourced from PALETTE_GROUPS. */
export const PALETTE_BPMN_ICONS: Record<string, string> = Object.fromEntries(
  PALETTE_GROUPS.flatMap((group) =>
    group.items
      .filter((item): item is PaletteEntry & { icon: string } => !!item.icon)
      .map((item) => [item.bpmnType, item.icon] as const)
  )
);

/** Icon for a BPMN type; falls through palette entries to BPMN_ICON_OVERRIDES. */
export function getPaletteIconForBpmnType(bpmnType: string | undefined): string | undefined {
  if (!bpmnType) return undefined;
  return PALETTE_BPMN_ICONS[bpmnType] ?? BPMN_ICON_OVERRIDES[bpmnType];
}
