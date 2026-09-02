/** What the context pad offers for a selection, as data; the host renders and wires it. */

import { BPMN } from '@core/constants.ts';

export type ContextPadAction =
  | 'append.end-event'
  | 'append.text-annotation'
  | 'append'
  | 'replace'
  | 'connect'
  | 'delete'
  | 'set-color'
  | 'flow.toggle-default'
  | 'choreography.swap-initiator'
  | 'expand.toggle'
  | 'drilldown';

export type ContextPadIcon =
  | 'end-event'
  | 'annotation'
  | 'append'
  | 'wrench'
  | 'trash'
  | 'palette'
  | 'connect'
  | 'default-flow'
  | 'swap'
  | 'subprocess'
  | 'open';

export type ContextPadAppend = {
  bpmnType: string;
  extensionType?: string;
};

export type ContextPadEntry = {
  action: ContextPadAction;
  /** Tooltip, as an English translation key. */
  title: string;
  icon: ContextPadIcon;
  /** The known successor this entry appends (previewed on hover, committed on click). */
  append?: ContextPadAppend;
};

export type ContextPadContext = {
  count: number;
  isShape: boolean;
  isConnection?: boolean;
  isLabel?: boolean;
  canAppend: boolean;
  canConnect: boolean;
  canAnnotate: boolean;
  canReplace: boolean;
  canToggleDefault?: boolean;
  isDefault?: boolean;
  isChoreographyTask: boolean;
  isExpandable?: boolean;
  isExpanded?: boolean;
};

export const END_EVENT_APPEND: ContextPadAppend = { bpmnType: BPMN.EndEvent, extensionType: 'studyflow:EndEvent' };
export const TEXT_ANNOTATION_APPEND: ContextPadAppend = { bpmnType: BPMN.TextAnnotation };

export function contextPadEntries(context: ContextPadContext): ContextPadEntry[] {
  const entries: ContextPadEntry[] = [];
  const single = context.count === 1;
  const shape = single && context.isShape && !context.isLabel;

  if (shape && context.canAppend) {
    entries.push({ action: 'append.end-event', title: 'Append end event', icon: 'end-event', append: END_EVENT_APPEND });
  }
  if (single && (shape || context.isConnection) && context.canAnnotate) {
    entries.push({ action: 'append.text-annotation', title: 'Add text annotation', icon: 'annotation', append: TEXT_ANNOTATION_APPEND });
  }
  if (shape && context.canAppend) entries.push({ action: 'append', title: 'Append element', icon: 'append' });
  if (shape && context.canReplace) entries.push({ action: 'replace', title: 'Change element', icon: 'wrench' });

  entries.push({ action: 'delete', title: 'Delete', icon: 'trash' });
  entries.push({ action: 'set-color', title: 'Set color', icon: 'palette' });

  if (single && context.isConnection && context.canToggleDefault) {
    entries.push({
      action: 'flow.toggle-default',
      title: context.isDefault ? 'Unset default flow' : 'Set as default flow',
      icon: 'default-flow',
    });
  }
  if (shape && context.canConnect) entries.push({ action: 'connect', title: 'Connect to other element', icon: 'connect' });
  if (single && context.isChoreographyTask) {
    entries.push({ action: 'choreography.swap-initiator', title: 'Switch initiating participant', icon: 'swap' });
  }
  if (shape && context.isExpandable) {
    entries.push({ action: 'expand.toggle', title: context.isExpanded ? 'Collapse' : 'Expand', icon: 'subprocess' });
    entries.push({ action: 'drilldown', title: 'Open contents', icon: 'open' });
  }
  return entries;
}
