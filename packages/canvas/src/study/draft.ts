/**
 * A drawing for what a document leaves undrawn, written into its DI for the import to read. A document with no
 * drawing at all gets one, for the study to lay out as it reads it: each shape at its default size at the origin, a
 * boundary event on its activity's lower edge, a note above and right of what it annotates, a sub-process closed over
 * its contents, a group empty (the layout draws it round the shapes its category names), and each flow. A drawn
 * document whose data associations are not all drawn gets a route for each one both of whose ends are drawn.
 */

import { isDataAssociationType } from '@core/element/index.ts';
import { getProperty, setProperty } from '@core/element/moddle.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import { asList, asModdle, mint, modelOf, setParent, type ModdleFactory } from '@canvas/study/moddle.ts';
import { routeFor } from '@canvas/study/orthogonal.ts';
import { defaultSizeFor } from '@canvas/study/prototype.ts';
import type { Bounds, ModdleObject } from '@canvas/study/scene.ts';

const DATA_ASSOCIATIONS = ['dataInputAssociations', 'dataOutputAssociations'];
/** How far a drafted note stands from what it annotates. */
const NOTE_GAP = 20;

/** Draft a drawing for `definitions` when they hold none; whether it did. */
export function draftDrawing(definitions: ModdleObject): boolean {
  if (asList(getProperty(firstPlane(definitions), 'planeElement')).length > 0) return false;
  // A collaboration is drawn when a pool of it holds a process; one whose pools hold none (a study's actors, a
  // choreography's participants) only declares them, and the drawing stands on the process.
  const roots = asList(getProperty(definitions, 'rootElements'));
  const root = roots.find((element) => element.$type === 'bpmn:Collaboration' && asList(getProperty(element, 'participants')).some((pool) => getProperty(pool, 'processRef')))
    ?? roots.find((element) => element.$type === 'bpmn:Process');
  if (!root) return false;
  const factory = modelOf(definitions);
  const shapes: ModdleObject[] = [];
  const edges: ModdleObject[] = [];
  const drawContents = (container: ModdleObject): void => {
    for (const element of asList(getProperty(container, 'flowElements'))) {
      if (isBpmnSubtypeOf(element.$type, 'bpmn:SequenceFlow')) edges.push(element);
      else if (element.$type !== 'bpmn:DataObject') shapes.push(element);
      edges.push(...DATA_ASSOCIATIONS.flatMap((name) => asList(getProperty(element, name))).filter(isDrawnAssociation));
      drawContents(element);
    }
    for (const artifact of asList(getProperty(container, 'artifacts'))) (isBpmnSubtypeOf(artifact.$type, 'bpmn:Association') ? edges : shapes).push(artifact);
    const drawLanes = (holder: ModdleObject | undefined): void => {
      for (const lane of asList(getProperty(holder, 'lanes'))) {
        shapes.push(lane);
        drawLanes(asModdle(getProperty(lane, 'childLaneSet')));
      }
    };
    for (const laneSet of asList(getProperty(container, 'laneSets'))) drawLanes(laneSet);
  };
  if (root.$type === 'bpmn:Collaboration') {
    for (const pool of asList(getProperty(root, 'participants'))) {
      shapes.push(pool);
      const process = asModdle(getProperty(pool, 'processRef'));
      if (process) drawContents(process);
    }
    edges.push(...asList(getProperty(root, 'messageFlows')));
    for (const artifact of asList(getProperty(root, 'artifacts'))) (isBpmnSubtypeOf(artifact.$type, 'bpmn:Association') ? edges : shapes).push(artifact);
  } else {
    drawContents(root);
  }

  const boxes = new Map<ModdleObject, Bounds>(shapes.map((shape) => [shape, { x: 0, y: 0, ...(shape.$type === 'bpmn:Group' ? { width: 0, height: 0 } : defaultSizeFor(shape.$type)) }] as const));
  for (const link of edges.filter((edge) => edge.$type === 'bpmn:Association')) {
    const [from, to] = [asModdle(getProperty(link, 'sourceRef')), asModdle(getProperty(link, 'targetRef'))];
    const [note, other] = from?.$type === 'bpmn:TextAnnotation' ? [from, to] : [to, from];
    const [box, beside] = [note && boxes.get(note), other && boxes.get(other)];
    if (note?.$type === 'bpmn:TextAnnotation' && box && beside) boxes.set(note, { ...box, x: beside.width + NOTE_GAP, y: -box.height - NOTE_GAP });
  }
  // What sits on an activity sits on its lower edge, spread along it.
  const onHost = new Map<ModdleObject, ModdleObject[]>();
  for (const shape of shapes) {
    const host = asModdle(getProperty(shape, 'attachedToRef'));
    if (host) onHost.set(host, [...(onHost.get(host) ?? []), shape]);
  }
  for (const [host, events] of onHost) {
    const at = boxes.get(host);
    if (!at) continue;
    events.forEach((event, i) => {
      const box = boxes.get(event)!;
      boxes.set(event, { ...box, x: at.x + (at.width * (i + 1)) / (events.length + 1) - box.width / 2, y: at.y + at.height - box.height / 2 });
    });
  }
  const planeElements = [
    ...shapes.map((shape) => shapeDi(factory, shape, boxes.get(shape)!, asList(getProperty(shape, 'flowElements')).length > 0 ? false : undefined)),
    ...edges.map((edge) => edgeDi(factory, edge, [{ x: 0, y: 0 }, { x: 0, y: 0 }])),
  ];
  const plane = mint(factory, 'bpmndi:BPMNPlane', { id: 'BPMNPlane_1', bpmnElement: root, planeElement: planeElements });
  for (const di of planeElements) setParent(di, plane);
  const diagram = mint(factory, 'bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1', plane });
  setParent(plane, diagram);
  setParent(diagram, definitions);
  setProperty(definitions, 'diagrams', [diagram]);
  return true;
}

/** Route each data association the drawing leaves out, both of whose ends it draws. */
export function drawDataFlow(definitions: ModdleObject): void {
  const plane = firstPlane(definitions);
  const drawn = asList(getProperty(plane, 'planeElement'));
  const boxes = new Map<ModdleObject, Bounds & { type: string }>();
  const hasEdge = new Set<ModdleObject>();
  for (const di of drawn) {
    const element = asModdle(getProperty(di, 'bpmnElement'));
    const bounds = asModdle(getProperty(di, 'bounds'));
    if (!element) continue;
    if (bounds) boxes.set(element, { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height), type: element.$type });
    else hasEdge.add(element);
  }
  const factory = modelOf(definitions);
  const added: ModdleObject[] = [];
  for (const [activity, box] of boxes) {
    for (const name of DATA_ASSOCIATIONS) {
      for (const association of asList(getProperty(activity, name))) {
        const data = dataEndOf(association);
        const dataBox = data && boxes.get(data);
        if (hasEdge.has(association) || !dataBox || !isDrawnAssociation(association)) continue;
        const [source, target] = association.$type === 'bpmn:DataInputAssociation' ? [dataBox, box] : [box, dataBox];
        added.push(edgeDi(factory, association, routeFor(association.$type, source, target)));
      }
    }
  }
  if (added.length === 0) return;
  for (const di of added) setParent(di, plane);
  setProperty(plane, 'planeElement', [...drawn, ...added]);
}

/** Whether a data association reads or writes a data shape, which a drawing can end it on. */
function isDrawnAssociation(association: ModdleObject): boolean {
  const data = dataEndOf(association);
  return !!data && (data.$type === 'bpmn:DataObjectReference' || data.$type === 'bpmn:DataStoreReference');
}

/** The data a data association reads or writes: an input's source, an output's target. */
function dataEndOf(association: ModdleObject): ModdleObject | undefined {
  if (!isDataAssociationType(association.$type)) return undefined;
  return association.$type === 'bpmn:DataInputAssociation'
    ? asList(getProperty(association, 'sourceRef'))[0]
    : asModdle(getProperty(association, 'targetRef'));
}

function firstPlane(definitions: ModdleObject): ModdleObject | undefined {
  return asModdle(getProperty(asList(getProperty(definitions, 'diagrams'))[0], 'plane'));
}

function shapeDi(factory: ModdleFactory | undefined, element: ModdleObject, box: Bounds, isExpanded: boolean | undefined): ModdleObject {
  const bounds = mint(factory, 'dc:Bounds', { x: box.x, y: box.y, width: box.width, height: box.height });
  const di = mint(factory, 'bpmndi:BPMNShape', { id: `${element.id}_di`, bpmnElement: element, bounds, ...(isExpanded !== undefined ? { isExpanded } : {}) });
  setParent(bounds, di);
  return di;
}

function edgeDi(factory: ModdleFactory | undefined, element: ModdleObject, points: readonly { x: number; y: number }[]): ModdleObject {
  const waypoint = points.map((p) => mint(factory, 'dc:Point', { x: p.x, y: p.y }));
  const di = mint(factory, 'bpmndi:BPMNEdge', { id: `${element.id}_di`, bpmnElement: element, waypoint });
  for (const point of waypoint) setParent(point, di);
  return di;
}
