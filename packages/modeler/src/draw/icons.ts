import { BPMN } from '@core/constants';
import { ICONS } from '@modeler/icons';

/** Membership here also forces generic Task rendering in `drawActivity`, so markers belong in MARKER_ICONS instead. */
export const BPMN_ICON_OVERRIDES: Record<string, string> = {
  [BPMN.ManualTask]:          `${ICONS.handLeft} rotate-90`,
  [BPMN.UserTask]:            ICONS.person,
  [BPMN.ServiceTask]:         ICONS.cog,
  [BPMN.ScriptTask]:          ICONS.script,
  [BPMN.SendTask]:            ICONS.envelope,
  [BPMN.ReceiveTask]:         ICONS.envelopeOpen,
  [BPMN.BusinessRuleTask]:    ICONS.tableGrid,
  [BPMN.ExclusiveGateway]:    ICONS.crossThin,
  [BPMN.ParallelGateway]:     ICONS.plusThin,
  [BPMN.InclusiveGateway]:    ICONS.circleOutline,
  [BPMN.ComplexGateway]:      ICONS.asterisk,
  [BPMN.EventBasedGateway]:   ICONS.pentagon,
  [BPMN.DataObjectReference]: ICONS.document,

  // Event-definition symbols, drawn centred on the event circle; the canvas asks
  // the resolver per definition $type (`render/renderer.ts drawEventIcons`).
  'bpmn:MessageEventDefinition':     ICONS.envelope,
  'bpmn:TimerEventDefinition':       'iconify ph--clock',
  'bpmn:ErrorEventDefinition':       'iconify ph--lightning',
  'bpmn:SignalEventDefinition':      'iconify ph--triangle',
  'bpmn:EscalationEventDefinition':  'iconify ph--caret-double-up',
  'bpmn:ConditionalEventDefinition': 'iconify ph--article',
  'bpmn:LinkEventDefinition':        'iconify ph--arrow-right',
  'bpmn:TerminateEventDefinition':   'iconify ph--circle-fill',
  'bpmn:CompensateEventDefinition':  ICONS.bpmnCompensationMarker,
  'bpmn:CancelEventDefinition':      ICONS.crossThin,
};

export const MARKER_ICONS: Record<string, string> = {
  'subprocess':   ICONS.plusBox,
  'adhoc':        ICONS.tilde,
  'parallel':     `${ICONS.menu} rotate-90`,
  'sequential':   ICONS.menu,
  'loop':         ICONS.loop,
  'compensation': ICONS.bpmnCompensationMarker,
  'checklist':    ICONS.checkbox,
  'function':     ICONS.function,
};
