/**
 * The Add panel: every element and template the modeler can add (`palette/catalog.ts`), in two views. Elements are
 * found by name, narrowed by skill and filed by kind; templates are cards, each a picture of what it drops
 * (`palette/templatePicture.ts`). Every entry has the pin that puts it in the tools column. Three places open it, and
 * each says what a pick does: the tools' + arms it as a tool does (it follows the pointer, and a click drops it), a double click
 * on the canvas puts it there, and the selection's append puts it after the selection, connected. A row dragged out
 * drops where it is let go, from any of them.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { BPMN } from '@core/constants';
import { isBpmnSubtypeOf } from '@core/notation';
import { executeCommand } from '@modeler/commandBus';
import { addEntries, byKind, type AddEntry } from '@modeler/palette/catalog';
import { togglePin } from '@modeler/palette/pins';
import { templatePicture } from '@modeler/palette/templatePicture';
import { startCreate } from '@modeler/palette/usePaletteDrag';
import { mustDragToAppend, type AddWhat } from '@modeler/popup/commands';
import type { PopupMenuItem, PopupMenuModel } from '@modeler/popup/PopupMenu';
import type { PopupPosition } from '@modeler/editor/popupMenus';
import type { Editor } from '@modeler/editor/port';

/** Where a pick goes: after the pointer (the tools' +), to a point on screen (a double click), after an element, or on a flow (its +), between its ends. */
export type AddTo =
  | { kind: 'pointer' }
  | { kind: 'point'; at: { x: number; y: number } }
  | { kind: 'element'; id: string; name: string }
  | { kind: 'flow'; id: string; from: string; between: [string, string] };

/** The filter BPMN's own entries answer to; a skill's answer to its prefix. */
const OWN = { id: 'bpmn', label: 'BPMN' };

/** Wide enough for the shipped skills' filters on two rows. */
const PANEL_WIDTH = 340;

function whatOf(entry: AddEntry): AddWhat {
  return {
    bpmnType: entry.bpmnType,
    ...(entry.extensionType ? { extensionType: entry.extensionType } : {}),
    ...(entry.attributes ? { attributes: entry.attributes } : {}),
    ...(entry.template ? { template: entry.template } : {}),
  };
}

/**
 * A mouse event the canvas's create gesture can read coordinates off. A pick by keyboard has no pointer, so the
 * anchor's own cursor stands in, and the gesture starts where the panel was opened from.
 */
function pointerEventFor(event: ReactMouseEvent, anchor: PopupPosition): MouseEvent {
  const native = (event as unknown as { nativeEvent?: MouseEvent })?.nativeEvent ?? (event as unknown as MouseEvent);
  if (typeof native?.clientX === 'number' && (native.clientX !== 0 || native.clientY !== 0)) return native;
  return new MouseEvent('mousemove', { clientX: anchor.cursor.x, clientY: anchor.cursor.y, bubbles: true });
}

/** Whether `entry` can follow the element `from`; a boundary event is offered for its drag, which finds it a host. */
function follows(modeler: Editor, from: string, entry: AddEntry): boolean {
  if (mustDragToAppend(entry.bpmnType)) return true;
  const what = entry.template ? { template: entry.template } : { type: entry.bpmnType, ...(entry.extensionType ? { extension: entry.extensionType } : {}) };
  return modeler.study.can('append', { from, ...what }).ok;
}

/** The search's prompt: what a pick does where it does something in place, else what the view holds. */
/** Whether a flow can run through what `entry` adds: a flow node other than an event that starts, ends or waits on a host. */
function passesThrough(entry: AddEntry): boolean {
  return isBpmnSubtypeOf(entry.bpmnType, 'bpmn:FlowNode')
    && ![BPMN.StartEvent, BPMN.EndEvent, BPMN.BoundaryEvent].includes(entry.bpmnType as never);
}

function placeholderFor(to: AddTo, what: 'elements' | 'templates'): string {
  if (to.kind === 'element') return `Append to ${to.name}...`;
  if (to.kind === 'flow') return `Between ${to.between[0]} and ${to.between[1]}...`;
  if (to.kind === 'point') return 'Add here...';
  return `Search ${what}...`;
}

/** The panel for `to`, with `pinned` (the pinned entries' ids) marked, opened at `anchor`. */
export function addMenu(modeler: Editor, to: AddTo, pinned: readonly string[], anchor: PopupPosition): PopupMenuModel {
  const entries = addEntries().filter((entry) => {
    if (to.kind === 'element') return follows(modeler, to.id, entry);
    // On a flow: a step the flow can run through, which takes a flow in and lets one out.
    if (to.kind === 'flow') return passesThrough(entry) && follows(modeler, to.from, entry);
    return true;
  });
  const elements = entries.filter((entry) => !entry.template);
  const templates = entries.filter((entry) => entry.template);
  const filters = new Map<string, string>();
  for (const entry of elements) filters.set(entry.skill?.prefix ?? OWN.id, entry.skill?.name ?? OWN.label);

  const row = (entry: AddEntry): PopupMenuItem => {
    const what = whatOf(entry);
    const drag = (event: ReactMouseEvent): void => startCreate(modeler, what, pointerEventFor(event, anchor));
    return {
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      keywords: entry.keywords,
      // A skill's row names its skill; BPMN's own go untagged, so the skills' stand out.
      ...(entry.skill ? { tag: entry.skill.name } : {}),
      // Templates are few, and their cards name their skill: only elements are narrowed by one.
      ...(entry.template
        ? { picture: () => templatePicture(entry.template!, modeler.model.metamodel()) }
        : { filter: entry.skill?.prefix ?? OWN.id }),
      title: entry.description ? `${entry.label}: ${entry.description}` : entry.label,
      pin: { pinned: pinned.includes(entry.id), toggle: () => togglePin(entry.id) },
      onDragStart: drag,
      onSelect: (event) => {
        if (to.kind === 'point') void executeCommand(modeler, { type: 'AddElementAt', ...what, at: to.at });
        else if (to.kind === 'flow') void executeCommand(modeler, { type: 'InsertElement', into: to.id, ...what });
        else if (to.kind === 'element' && !mustDragToAppend(entry.bpmnType)) void executeCommand(modeler, { type: 'AppendElement', from: to.id, ...what });
        else drag(event);
      },
    };
  };

  return {
    width: PANEL_WIDTH,
    search: true,
    views: [
      { id: 'elements', label: 'Elements', placeholder: placeholderFor(to, 'elements') },
      { id: 'templates', label: 'Templates', placeholder: placeholderFor(to, 'templates') },
    ],
    filters: [...filters].map(([id, label]) => ({ id, label })),
    ...(entries.length === 0 ? { emptyText: 'Nothing can follow this element' } : {}),
    sections: [
      ...byKind(elements).map(({ kind, entries: filed }) => ({ id: kind, name: kind, view: 'elements', items: filed.map(row) })),
      { id: 'templates', view: 'templates', layout: 'cards' as const, items: templates.map(row) },
    ],
  };
}
