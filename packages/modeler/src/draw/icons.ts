import { BPMN } from '@core/constants';
import { ICONS } from '@modeler/icons';

/** The glyph a BPMN type draws when neither a template nor its extension type names one (`editor/mount.ts resolveIcon`); markers belong in MARKER_ICONS. */
export const BPMN_ICON_OVERRIDES: Record<string, string> = {
  [BPMN.ManualTask]:          `${ICONS.hand} rotate-90`,
  [BPMN.UserTask]:            ICONS.person,
  [BPMN.ServiceTask]:         ICONS.gear,
  [BPMN.ScriptTask]:          ICONS.script,
  [BPMN.SendTask]:            ICONS.envelope,
  [BPMN.ReceiveTask]:         ICONS.envelopeOpen,
  [BPMN.BusinessRuleTask]:    ICONS.table,
  [BPMN.ExclusiveGateway]:    ICONS.close,
  [BPMN.ParallelGateway]:     ICONS.plus,
  [BPMN.InclusiveGateway]:    ICONS.circle,
  [BPMN.ComplexGateway]:      ICONS.asterisk,
  [BPMN.EventBasedGateway]:   ICONS.pentagon,
  [BPMN.DataObjectReference]: ICONS.document,

  // Event-definition symbols, drawn centred on the event circle; the canvas asks
  // the resolver per definition $type (`render/renderer.ts drawEventIcons`).
  'bpmn:MessageEventDefinition':     ICONS.envelope,
  'bpmn:TimerEventDefinition':       'iconify tabler--clock',
  'bpmn:ErrorEventDefinition':       'iconify tabler--bolt',
  'bpmn:ErrorEventDefinition:end':   'iconify tabler--bolt-filled',   // the throwing form, filled
  'bpmn:SignalEventDefinition':      'iconify tabler--triangle',
  'bpmn:EscalationEventDefinition':  'iconify tabler--navigation',
  'bpmn:ConditionalEventDefinition': 'iconify tabler--notes',
  'bpmn:LinkEventDefinition':        'iconify tabler--arrow-right',
  'bpmn:TerminateEventDefinition':   'iconify tabler--circle-filled',
  'bpmn:CompensateEventDefinition':  ICONS.compensation,
  'bpmn:CancelEventDefinition':      ICONS.close,
};

export const MARKER_ICONS: Record<string, string> = {
  'subprocess':   ICONS.plusBox,
  'adhoc':        ICONS.tilde,
  'parallel':     `${ICONS.list} rotate-90`,
  'sequential':   ICONS.list,
  'loop':         ICONS.loop,
  'compensation': ICONS.compensation,
  'checklist':    ICONS.checkbox,
  'function':     ICONS.function,
};
