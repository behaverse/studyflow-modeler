/**
 * A drawing for what a study leaves undrawn, written into its layout for the import to read. A study with no
 * drawing at all gets one, for the study to lay out as it reads it: each shape at its default size at the origin, a
 * boundary event on its activity's lower edge, a note above and right of what it annotates, a sub-process closed over
 * its contents, a group empty (the layout draws it round the shapes its category names), and each flow. A drawn
 * study gets the same for what a sub-process it draws closed holds, when it leaves any of that out, for the study to
 * lay out on that sub-process's own plane; and a route for each flow it leaves out both of whose ends are drawn, in
 * the look the study gives it.
 */

import { isDataAssociationType } from '@core/element/index.ts';
import type { Drawing, Element, StudyModel } from '@core/model/index.ts';
import { boxToText, pointsToText } from '@core/model/spelling.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import { lookOf } from '@canvas/study/di.ts';
import { listOf, refOf } from '@canvas/study/elements.ts';
import { boxOf } from '@canvas/study/import.ts';
import { routeFor } from '@canvas/study/orthogonal.ts';
import { defaultSizeFor } from '@canvas/study/prototype.ts';
import type { Bounds } from '@canvas/study/scene.ts';

const DATA_ASSOCIATIONS = ['dataInputAssociations', 'dataOutputAssociations'];
/** How far a drafted note stands from what it annotates. */
const NOTE_GAP = 20;

/** What a draft draws: the shapes, and the flows between them. */
interface Draft {
  shapes: Element[];
  edges: Element[];
}

/** Draft a drawing for `model` when it holds none; whether it did. */
export function draftDrawing(model: StudyModel): boolean {
  if (Object.keys(model.study.layout).length > 0) return false;
  // A collaboration is drawn when a pool of it holds a process; one whose pools hold none (a study's actors, a
  // choreography's participants) only declares them, and the drawing stands on the process.
  const { roots } = model.study;
  const root = roots.find((element) => model.host(element) === 'bpmn:Collaboration' && listOf(element, 'participants').some((pool) => pool.processRef))
    ?? roots.find((element) => model.host(element) === 'bpmn:Process');
  if (!root) return false;
  const draft: Draft = { shapes: [], edges: [] };
  if (model.host(root) === 'bpmn:Collaboration') {
    for (const pool of listOf(root, 'participants')) {
      draft.shapes.push(pool);
      const process = refOf(model, pool, 'processRef');
      if (process) drawContents(model, process, draft);
    }
    draft.edges.push(...listOf(root, 'messageFlows'));
    drawArtifacts(model, root, draft);
  } else {
    drawContents(model, root, draft);
  }
  place(model, draft);
  if (root !== model.primaryRoot()) model.study.diagram = [{ plane: { bpmnElement: root.id! } }];
  return true;
}

/**
 * Draft what each sub-process the drawing draws closed holds, when it leaves any of that out and no further diagram
 * draws its plane (as another tool draws a closed sub-process's contents). All of it is drafted, as if the drawing
 * placed none of it, so what the drawing leaves out is drafted where it was the last time; what it places is set
 * aside, for the study to put back. A sub-process inside one drafted is drafted with it. Answers the sub-processes
 * drafted, and what was set aside.
 */
export function draftClosedContents(model: StudyModel): { planes: string[]; placed: Record<string, Drawing> } {
  const { layout } = model.study;
  const drawn = (element: Element): boolean => ['bounds', 'waypoint'].some((key) => key in (layout[element.id!] ?? {}));
  const further = new Set((model.study.diagram ?? []).map((diagram) => ((diagram as Element).plane as Element | undefined)?.bpmnElement));
  const drafts = new Map<string, Draft>();
  for (const [id, drawing] of Object.entries(layout)) {
    const closed = model.get(id);
    if (!closed || drawing.isExpanded !== false || further.has(id)) continue;
    const draft: Draft = { shapes: [], edges: [] };
    drawContents(model, closed, draft);
    if (![...draft.shapes, ...draft.edges].every(drawn)) drafts.set(id, draft);
  }
  const inside = new Set([...drafts.values()].flatMap((draft) => draft.shapes.map((shape) => shape.id)));
  const planes = [...drafts.keys()].filter((id) => !inside.has(id));
  const placed: Record<string, Drawing> = {};
  for (const draft of planes.map((id) => drafts.get(id)!)) {
    for (const element of [...draft.shapes, ...draft.edges].filter(drawn)) {
      placed[element.id!] = layout[element.id!];
      const look = lookOf(layout[element.id!]);
      if (look) layout[element.id!] = look;
      else delete layout[element.id!];
    }
    place(model, draft);
  }
  return { planes, placed };
}

/** Add what `container` holds to `draft`, however deep: its flow, the data it reads and writes, its notes and lanes. */
function drawContents(model: StudyModel, container: Element, draft: Draft): void {
  for (const element of listOf(container, 'flowElements')) {
    if (isBpmnSubtypeOf(model.host(element), 'bpmn:SequenceFlow')) draft.edges.push(element);
    else if (model.host(element) !== 'bpmn:DataObject') draft.shapes.push(element);
    draft.edges.push(...DATA_ASSOCIATIONS.flatMap((name) => listOf(element, name)).filter((association) => isDrawnAssociation(model, association)));
    drawContents(model, element, draft);
  }
  drawArtifacts(model, container, draft);
  const drawLanes = (holder: Element | undefined): void => {
    for (const lane of listOf(holder, 'lanes')) {
      draft.shapes.push(lane);
      drawLanes(lane.childLaneSet as Element | undefined);
    }
  };
  for (const laneSet of listOf(container, 'laneSets')) drawLanes(laneSet);
}

/** Add `container`'s notes and groups to `draft`, and the links from its notes. */
function drawArtifacts(model: StudyModel, container: Element, draft: Draft): void {
  for (const artifact of listOf(container, 'artifacts')) (isBpmnSubtypeOf(model.host(artifact), 'bpmn:Association') ? draft.edges : draft.shapes).push(artifact);
}

/**
 * Write `draft` into the layout, with the look the layout gives any of it: each shape at the origin, each flow a stub,
 * in the order drafted, so the same draft is laid out the same way.
 */
function place(model: StudyModel, { shapes, edges }: Draft): void {
  const typeOf = (element: Element): string => model.host(element);
  const boxes = new Map<Element, Bounds>(shapes.map((shape) => [shape, { x: 0, y: 0, ...(typeOf(shape) === 'bpmn:Group' ? { width: 0, height: 0 } : defaultSizeFor(typeOf(shape))) }] as const));
  for (const link of edges.filter((edge) => typeOf(edge) === 'bpmn:Association')) {
    const [from, to] = [refOf(model, link, 'sourceRef'), refOf(model, link, 'targetRef')];
    const [note, other] = from && typeOf(from) === 'bpmn:TextAnnotation' ? [from, to] : [to, from];
    const [at, beside] = [note && boxes.get(note), other && boxes.get(other)];
    if (note && typeOf(note) === 'bpmn:TextAnnotation' && at && beside) boxes.set(note, { ...at, x: beside.width + NOTE_GAP, y: -at.height - NOTE_GAP });
  }
  // What sits on an activity sits on its lower edge, spread along it.
  const onHost = new Map<Element, Element[]>();
  for (const shape of shapes) {
    const host = refOf(model, shape, 'attachedToRef');
    if (host) onHost.set(host, [...(onHost.get(host) ?? []), shape]);
  }
  for (const [host, events] of onHost) {
    const at = boxes.get(host);
    if (!at) continue;
    events.forEach((event, i) => {
      const drafted = boxes.get(event)!;
      boxes.set(event, { ...drafted, x: at.x + (at.width * (i + 1)) / (events.length + 1) - drafted.width / 2, y: at.y + at.height - drafted.height / 2 });
    });
  }
  const { layout } = model.study;
  const write = (element: Element, drawing: Drawing): void => {
    const look = layout[element.id!];
    delete layout[element.id!];
    layout[element.id!] = { ...drawing, ...look };
  };
  for (const shape of shapes) write(shape, { bounds: boxToText(boxes.get(shape)!), ...(listOf(shape, 'flowElements').length > 0 ? { isExpanded: false } : {}) });
  for (const edge of edges) write(edge, { waypoint: pointsToText([{ x: 0, y: 0 }, { x: 0, y: 0 }]) });
}

/** The flows a route is drawn for: what a study's sequence and message flows, notes' links and data run along. */
const ROUTED = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association'];

/** Route each flow the drawing leaves out, or draws only the look of, both of whose ends it draws. */
export function drawFlows(model: StudyModel): void {
  const { layout } = model.study;
  const boxes = new Map<Element, Bounds>();
  for (const [id, drawing] of Object.entries(layout)) {
    const element = model.get(id);
    const at = 'bounds' in drawing ? boxOf(drawing.bounds) : undefined;
    if (element && at) boxes.set(element, { x: at.x ?? 0, y: at.y ?? 0, width: at.width ?? 0, height: at.height ?? 0 });
  }
  const undrawn = (flow: Element): boolean => !!flow.id && !('waypoint' in (layout[flow.id] ?? {}));
  const draw = (flow: Element, source: Bounds, target: Bounds): void => {
    layout[flow.id!] = { waypoint: pointsToText(routeFor(model.host(flow), source, target)), ...layout[flow.id!] };
  };
  for (const [activity, at] of boxes) {
    for (const name of DATA_ASSOCIATIONS) {
      for (const association of listOf(activity, name)) {
        const data = dataEndOf(model, association);
        const dataBox = data && boxes.get(data);
        if (!undrawn(association) || !dataBox || !isDrawnAssociation(model, association)) continue;
        const input = model.host(association) === 'bpmn:DataInputAssociation';
        draw(association, input ? dataBox : at, input ? at : dataBox);
      }
    }
  }
  for (const flow of model.all()) {
    if (!undrawn(flow) || !ROUTED.some((type) => isBpmnSubtypeOf(model.host(flow), type))) continue;
    const [source, target] = [refOf(model, flow, 'sourceRef'), refOf(model, flow, 'targetRef')].map((end) => end && boxes.get(end));
    if (source && target) draw(flow, source, target);
  }
}

/** Whether a data association reads or writes a data shape, which a drawing can end it on. */
function isDrawnAssociation(model: StudyModel, association: Element): boolean {
  const data = dataEndOf(model, association);
  const type = data && model.host(data);
  return type === 'bpmn:DataObjectReference' || type === 'bpmn:DataStoreReference';
}

/** The data a data association reads or writes: an input's source, an output's target. */
function dataEndOf(model: StudyModel, association: Element): Element | undefined {
  const type = model.host(association);
  if (!isDataAssociationType(type)) return undefined;
  return refOf(model, association, type === 'bpmn:DataInputAssociation' ? 'sourceRef' : 'targetRef');
}
