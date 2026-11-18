import type { IconDef } from '@canvas/index.ts';
import { BPMN } from '@core/constants';
import { extensionTypeOf, heldAttribute, type Element } from '@core/model/index';
import { getCatalog } from '@core/notation';
import { ICONS } from '@modeler/icons';

/** The glyph a BPMN type draws when neither a template nor its extension type names one (`resolveIcon`); markers belong in MARKER_ICONS. */
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

/**
 * A `data:` image draws as itself (a URL to fetch does not: nothing fetches an icon); anything
 * else is a class the app's stylesheet paints, whose glyph the canvas inlines from the CSS.
 */
const iconFor = (icon: string): IconDef => (/^data:image\//i.test(icon) ? { href: icon } : { cssClass: icon });

/**
 * The app's glyph pipeline as the canvas's icon resolver: a marker name or a BPMN
 * local name in, a resolved glyph out. `null` means "this type has no glyph". The live canvas, its pictures (Save As,
 * the Manuscript), the New dialog's cards and the Add panel's template pictures all draw with it.
 */
export function resolveIcon(iconKey: string, element?: Element): IconDef | null | undefined {
  const marker = MARKER_ICONS[iconKey];
  if (marker) return iconFor(marker);
  if (iconKey.startsWith('iconify ') || iconKey.startsWith('i-')) return iconFor(iconKey);
  if (element) {
    const templateIcon = heldAttribute(element, 'icon');
    const extensionType = extensionTypeOf(element);
    const extEntry = extensionType ? getCatalog().getType(extensionType) : undefined;
    const bpmnFallback = iconKey === 'DataObjectReference' ? undefined : BPMN_ICON_OVERRIDES[`bpmn:${iconKey}`];
    const icon = templateIcon || extEntry?.iconClass || bpmnFallback;
    if (typeof icon === 'string' && icon) return iconFor(icon);
  }
  // The canvas draws anything else with its own glyph, when it has one.
  return undefined;
}
