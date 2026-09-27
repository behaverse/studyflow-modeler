/**
 * Tidy Layout: lay a drawn process out afresh, with the engine that draws a file that comes without a drawing
 * (`autoLayout.ts`), as one edit. Each shape keeps its size and moves to the middle of its new place, taking its
 * caption and whatever sits on it along; the engine's grid is spread for shapes larger than its cells, a data shape
 * goes below whatever it would land on, a note follows what it annotates, and a pinned flow caption goes by the middle
 * of its flow's two ends. The canvas's router then draws every flow afresh.
 */

import type { Bounds, ElementRecord, Point, Study, StudyResult } from '@canvas/index.ts';
import { isDataShape } from '@core/document/outline';
import { ensureDiagramLayout } from '@modeler/diagram/autoLayout';
import { pickBounds } from '@modeler/diagram/dataFlowLayout';

/** The engine's grid cell (bpmn-auto-layout's `DEFAULT_CELL_WIDTH`/`HEIGHT`), and the room it leaves round a stock task. */
const CELL = { width: 150, height: 140 };
const ROOM = { width: CELL.width - 100, height: CELL.height - 80 };
/** How far below what it would land on a data shape goes. */
const DATA_GAP = 20;

/**
 * Why the engine cannot lay `study` out, or nothing: it draws one process, without lanes, open containers or groups
 * (it walks the flow depth first, so what a group holds, a phase across two arms, would come apart).
 */
export function untidyable(study: Study): string | undefined {
  if (study.root.type !== 'bpmn:Process') return 'Tidy Layout lays out a single process, and this diagram has pools.';
  if (study.list({ type: 'bpmn:Lane' }).length > 0) return 'Tidy Layout cannot lay out lanes.';
  if (study.list({ type: 'bpmn:Group' }).length > 0) return 'Tidy Layout cannot keep groups round what they hold.';
  if (study.list({ kind: 'node' }).some((record) => record.expanded && record.plane === undefined)) {
    return 'Tidy Layout lays out closed sub-processes only: collapse the open ones first.';
  }
  return undefined;
}

/** Lay `study` out afresh as one edit; a reason instead, when the engine cannot. */
export async function tidyLayout(study: Study, moddle: any): Promise<StudyResult | string> {
  const why = untidyable(study);
  if (why) return why;
  const centres = await laidOutCentres(await study.toXml(), moddle);
  const onRoot = (record: ElementRecord): boolean => record.plane === undefined;
  const shapes = study.list({ kind: 'node' }).filter((shape) => onRoot(shape) && shape.bounds);
  const flows = study.list({ kind: 'edge' }).filter(onRoot);
  if (centres.size === 0 && shapes.length > 0) return 'The layout engine could not lay this diagram out.';

  // What each shape the engine placed will cover; what sits on an activity goes where the activity goes.
  const placed = shapes.filter((shape) => centres.has(shape.id) && !shape.attachedTo);
  const boxes = spread(placed, centres);
  settleData(placed, boxes);
  const moves = new Map<string, Point>([...boxes].map(([id, box]) => {
    const from = study.get(id)!.bounds!;
    return [id, { x: Math.round(box.x - from.x), y: Math.round(box.y - from.y) }];
  }));
  // The engine leaves notes out: each follows what it annotates.
  for (const note of shapes.filter((shape) => shape.type === 'bpmn:TextAnnotation' && !moves.has(shape.id))) {
    const link = flows.find((flow) => flow.source === note.id || flow.target === note.id);
    const by = link && moves.get((link.source === note.id ? link.target : link.source) ?? '');
    if (by) moves.set(note.id, by);
  }
  // A pinned caption of a flow stays put as the flow's ends move apart: it goes by the middle of the two.
  for (const caption of study.list({ kind: 'label' }).filter((label) => label.pinned)) {
    const flow = flows.find((candidate) => candidate.id === caption.owner);
    const ends = flow ? [flow.source, flow.target].flatMap((id) => (id && moves.get(id)) || []) : [];
    if (ends.length > 0) moves.set(caption.id, average(ends));
  }

  return study.batch({
    steps: [
      ...[...moves].filter(([, by]) => by.x !== 0 || by.y !== 0).map(([id, by]) => ({ tool: 'move', args: { ids: [id], by } })),
      ...flows.map((flow) => ({ tool: 'reroute', args: { id: flow.id } })),
    ],
  });
}

/** Each placed shape's box, centred where the engine put it, with the grid spread wherever a shape outgrows its cell. */
function spread(placed: readonly ElementRecord[], centres: ReadonlyMap<string, Point>): Map<string, Bounds> {
  const across = Math.max(1, ...placed.map((shape) => (shape.bounds!.width + ROOM.width) / CELL.width));
  const down = Math.max(1, ...placed.map((shape) => (shape.bounds!.height + ROOM.height) / CELL.height));
  const origin = { x: Math.min(...placed.map((shape) => centres.get(shape.id)!.x)), y: Math.min(...placed.map((shape) => centres.get(shape.id)!.y)) };
  return new Map(placed.map((shape) => {
    const centre = centres.get(shape.id)!;
    const { width, height } = shape.bounds!;
    const x = origin.x + (centre.x - origin.x) * across;
    const y = origin.y + (centre.y - origin.y) * down;
    return [shape.id, { x: x - width / 2, y: y - height / 2, width, height }];
  }));
}

/** A data shape the engine put on top of another shape (it assumes stock sizes) goes below that shape instead. */
function settleData(placed: readonly ElementRecord[], boxes: Map<string, Bounds>): void {
  for (const data of placed.filter((shape) => isDataShape(shape.type))) {
    for (let tries = 0; tries < placed.length; tries += 1) {
      const box = boxes.get(data.id)!;
      const under = placed.find((other) => other !== data && overlap(box, boxes.get(other.id)!));
      if (!under) break;
      const below = boxes.get(under.id)!;
      boxes.set(data.id, { ...box, y: below.y + below.height + DATA_GAP });
    }
  }
}

/** Where the engine puts each shape of `xml`'s process, by id: the middle of its box. */
async function laidOutCentres(xml: string, moddle: any): Promise<Map<string, Point>> {
  const { rootElement: drawn } = await moddle.fromXML(xml);
  drawn.diagrams = [];
  const { xml: undrawn } = await moddle.toXML(drawn);
  const { rootElement: laidOut } = await moddle.fromXML(await ensureDiagramLayout(undrawn, moddle));
  const centres = new Map<string, Point>();
  for (const di of laidOut.diagrams?.[0]?.plane?.planeElement ?? []) {
    if (di.$type !== 'bpmndi:BPMNShape' || !di.bpmnElement?.id) continue;
    centres.set(di.bpmnElement.id, middleOf(pickBounds(di.bounds)));
  }
  return centres;
}

function middleOf(box: Bounds): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function overlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function average(points: readonly Point[]): Point {
  return {
    x: Math.round(points.reduce((sum, point) => sum + point.x, 0) / points.length),
    y: Math.round(points.reduce((sum, point) => sum + point.y, 0) / points.length),
  };
}
