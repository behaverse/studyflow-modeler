/**
 * Shared rendering constants for v2 node components.
 * Ported from v1/render/constants.js.
 */

/** Custom icon overrides for standard BPMN elements. */
export const BPMN_ICON_OVERRIDES: Record<string, string> = {
  'bpmn:ManualTask':        'iconify fluent--hand-left-24-regular rotate-90',
  'bpmn:UserTask':          'iconify bi--person',
  'bpmn:ServiceTask':       'iconify mdi--cog',
  'bpmn:ScriptTask':        'iconify fluent--script-24-regular',
  'bpmn:SendTask':          'iconify bi--envelope-fill',
  'bpmn:ReceiveTask':       'iconify bi--envelope-open',
  'bpmn:BusinessRuleTask':  'iconify mdi--table',
  'bpmn:ExclusiveGateway':  'iconify mdi--close',
  'bpmn:ParallelGateway':   'iconify mdi--plus',
  'bpmn:InclusiveGateway':  'iconify mdi--checkbox-blank-circle-outline',
  'bpmn:ComplexGateway':    'iconify mdi--asterisk',
  'bpmn:EventBasedGateway': 'iconify mdi--pentagon-outline',
};

/** Marker icon classes for activity markers. */
export const MARKER_ICONS: Record<string, string> = {
  'operation':    'iconify mdi--function',
  'subprocess':   'iconify mdi--plus-box-outline',
  'adhoc':        'iconify tabler--tilde',
  'parallel':     'iconify solar--hamburger-menu-linear rotate-90',
  'sequential':   'iconify solar--hamburger-menu-linear',
  'loop':         'iconify mdi--loop',
  'compensation': 'iconify bpmn--compensation-marker',
  'checklist':    'iconify mdi--checkbox-outline',
};
