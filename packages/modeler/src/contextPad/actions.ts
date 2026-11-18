/**
 * The commands on the selection, for the two places that offer them: the context pad beside it, and the command
 * palette's Selection group. Both take their entries from `contextPadEntries` and run them here, so the two never
 * offer different things under one name.
 */

import { executeCommand } from '@modeler/commandBus';
import { APPEND_MENU, COLOR_MENU, REPLACE_MENU, openPopupMenu } from '@modeler/editor/popupMenus';
import { contextPadEntries, type ContextPadAction, type ContextPadContext, type ContextPadEntry, type ContextPadIcon } from '@modeler/contextPad/entries';
import { ICONS } from '@modeler/icons';
import { t } from '@modeler/i18n';
import { isExpandable } from '@core/document/outline';
import type { ElementRecord } from '@canvas/index.ts';
import type { PaletteCommand } from '@modeler/commandPalette/types';
import type { Editor } from '@modeler/editor/port';

/**
 * The entry table (`entries.ts`) names its icons symbolically, so it stays a pure table the unit spec pins; this maps
 * each key to an Iconify class at render time, the way the titles go through `t()`.
 */
export const PAD_ICONS: Record<ContextPadIcon, string> = {
  'end-event': ICONS.bpmnEndEvent,
  annotation: ICONS.annotation,
  connect: ICONS.connect,
  append: ICONS.append,
  wrench: ICONS.replace,
  trash: ICONS.trash,
  palette: ICONS.paintBrush,
  'default-flow': ICONS.slash,
  reroute: ICONS.reroute,
  swap: ICONS.switchInitiator,
  expand: ICONS.expand,
  collapse: ICONS.collapse,
  open: ICONS.drilldown,
};

/** The three entries that open a menu, and the menu's heading. */
const MENUS: Partial<Record<ContextPadAction, { id: string; title: string }>> = {
  append: { id: APPEND_MENU, title: 'Append element' },
  replace: { id: REPLACE_MENU, title: 'Change element' },
  'set-color': { id: COLOR_MENU, title: 'Style' },
};

/**
 * The selection the commands act on, as the study holds it now. A caption gets commands only when it is the whole
 * selection: mixed with real elements, "delete" has no single meaning.
 */
export function actionableSelection(modeler: Editor, ids: readonly string[]): ElementRecord[] {
  const records = ids.flatMap((id) => modeler.study.get(id) ?? []);
  const captions = records.filter((record) => record.kind === 'label').length;
  return captions === 0 || records.length === 1 ? records : [];
}

/** What the study's rules let the selection do, asked by id (`study.can`): the context `contextPadEntries` reads. */
export function padContext(modeler: Editor, records: readonly ElementRecord[]): ContextPadContext {
  const { study } = modeler;
  const single = records.length === 1 ? records[0] : undefined;
  // A container that can be expanded: both container entries are gated on the one
  // answer, so no subclass can get the toggle without the drill-down or the other way round.
  // A pool is drawn open or closed too (closed, BPMN's black box, when it holds no flow), but has no plane to open.
  const expandable = single?.kind === 'node' && isExpandable(single.type) ? single : undefined;
  const pool = single?.kind === 'node' && single.type === 'bpmn:Participant' && (single.expanded === false || study.list({ within: single.id }).length === 0) ? single : undefined;
  // A sequence flow gets the toggle-default entry when BPMN gives its source a `default` (an exclusive, inclusive or
  // complex gateway, an activity). The metamodel says which sources those are.
  const flow = single?.kind === 'edge' && single.type === 'bpmn:SequenceFlow' ? single : undefined;
  const flowSource = flow?.source === undefined ? undefined : study.get(flow.source);
  const canToggleDefault = flowSource?.default !== undefined;
  // Asks the study's rules whether the one selected element can take part in `tool`.
  const can = (tool: 'append' | 'connect' | 'replace', args: Record<string, unknown>): boolean => !!single && study.can(tool, args).ok;
  return {
    count: records.length,
    isShape: single?.kind === 'node',
    isConnection: single?.kind === 'edge',
    isLabel: single?.kind === 'label',
    canAppend: can('append', { from: single?.id }),
    canConnect: can('connect', { from: single?.id }),
    canAnnotate: can('append', { from: single?.id, type: 'bpmn:TextAnnotation' }),
    canReplace: can('replace', { id: single?.id }),
    canToggleDefault,
    isDefault: canToggleDefault && !!flow && flowSource?.default === flow.id,
    isChoreographyTask: single?.type === 'bpmn:ChoreographyTask',
    isExpandable: !!expandable || !!pool,
    isExpanded: (expandable ?? pool)?.expanded !== false,
    hasPlane: !!expandable,
  };
}

/**
 * Runs `entry` on the selection `records`. An entry that opens a menu opens it at `menuAt`, in client coordinates:
 * beside the pad, or beside the selection when the palette runs it. `connect`, a drag out of the pad, is the pad's.
 */
export function applyPadEntry(modeler: Editor, entry: ContextPadEntry, records: readonly ElementRecord[], menuAt?: { x: number; y: number }): void {
  const menu = MENUS[entry.action];
  if (menu) {
    if (menuAt) openPopupMenu(menu.id, { ...menuAt, cursor: { ...menuAt } }, { title: t(menu.title), width: 260 });
    return;
  }
  const element = records.length === 1 ? records[0] : undefined;
  switch (entry.action) {
    case 'append.end-event':
    case 'append.text-annotation':
      if (element && entry.append) {
        void executeCommand(modeler, {
          type: 'AppendElement',
          from: element.id,
          bpmnType: entry.append.bpmnType,
          extensionType: entry.append.extensionType,
        });
      }
      return;
    case 'delete':
      // A caption is not an element of the document, so there is nothing to
      // remove: the trash beside a selected label means "take this text away", and
      // the text is the owner's `name`. Clearing it is one undo step and round-trips as the
      // absence of the attribute, where deleting the label element would either be
      // a silent no-op or take the whole shape with it.
      if (element?.kind === 'label') {
        void executeCommand(modeler, {
          type: 'UpdateAttribute',
          element: { id: element.owner },
          attributeName: 'name',
          value: '',
        });
        return;
      }
      void executeCommand(modeler, { type: 'DeleteElements', ids: records.map((record) => record.id) });
      return;
    case 'flow.toggle-default':
      if (element) void executeCommand(modeler, { type: 'ToggleDefaultFlow', id: element.id });
      return;
    case 'flow.reroute':
      if (element) void executeCommand(modeler, { type: 'RerouteFlow', id: element.id });
      return;
    case 'choreography.swap-initiator':
      if (element) void executeCommand(modeler, { type: 'SwapChoreographyInitiator', id: element.id });
      return;
    case 'expand.toggle':
      if (element) void executeCommand(modeler, { type: 'ToggleExpanded', id: element.id });
      return;
    case 'drilldown':
      if (element) void executeCommand(modeler, { type: 'DrillDown', id: element.id });
      return;
    default:
      return;
  }
}

const MINOR_WORDS = new Set(['a', 'an', 'as', 'and', 'of', 'on', 'or', 'the', 'to']);

/** A pad title as a palette row: Title Case, as menu commands are, and "..." on one that opens a menu. */
function commandLabel(entry: ContextPadEntry): string {
  const words = t(entry.title).split(' ').map((word, index) =>
    index > 0 && MINOR_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1));
  return `${words.join(' ')}${MENUS[entry.action] ? '...' : ''}`;
}

/**
 * The selection's commands as rows of the palette's Selection group, found by name: the pad's entries, but its drag
 * (`connect`). None while the simulation plays, as the pad then stands down.
 */
export function selectionCommands(modeler: Editor): PaletteCommand[] {
  const records = modeler.simulation.isActive() ? [] : actionableSelection(modeler, modeler.canvas.selection);
  if (records.length === 0) return [];
  const box = modeler.canvas.screenBox(records[0].id);
  const menuAt = box && { x: Math.round(box.x + box.width + 12), y: Math.round(box.y) };
  return contextPadEntries(padContext(modeler, records))
    .filter((entry) => entry.action !== 'connect')
    .map((entry) => ({
      id: `selection-${entry.action}`,
      group: 'Selection',
      label: commandLabel(entry),
      icon: PAD_ICONS[entry.icon],
      action: () => applyPadEntry(modeler, entry, records, menuAt),
    }));
}
