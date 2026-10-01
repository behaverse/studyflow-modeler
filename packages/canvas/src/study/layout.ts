/**
 * Layout: lay a diagram out afresh, as the study's `layout` verb does. The flow runs left to right in layers: a shape
 * sits one layer past the longest run of flows into it, with loops set aside; a start sits just before what it leads
 * to, and an end that one branch of a split runs into sits under the split. The pools of a collaboration share their
 * layers, a message counting as a flow, so what one pool sends stands before what another does with it. A flow drawn
 * down the page, with no pools or lanes, is laid out down the page.
 *
 * The shapes of a layer stand in rows, each taking its predecessors' row where it is free, so a chain keeps to one
 * line and a branch drops below. A shape much wider than most takes as many layers as it covers, so what other rows
 * and bands do meanwhile stands under it. A shape takes room for what goes with it: what sits on it, its caption and
 * theirs. A lane is a band of such rows, a pool a stack of lanes, and pools stack down the page, all as wide as the
 * widest. Lanes that hand work back and forth share their layers; lanes that are the phases of one flow, each handing
 * on only to later ones, each start again at the left edge.
 *
 * An open sub-process is laid out inside first and then placed like any shape; a closed one's plane is laid out apart.
 * A data shape stands in a row under the steps it feeds or takes from; the shapes no flow reaches (and the notes
 * nothing links) keep their own arrangement under that, or stand in rows when they have none (they overlap). A
 * boundary event keeps its place on its activity, a note its place beside what it annotates, and a group is drawn
 * round the shapes it held.
 *
 * Shapes keep their sizes; containers are sized round what they hold. Pure geometry on the scene: it writes the boxes
 * and returns what it moved, for the caller to route the flows afresh and commit.
 */

import { centerOf, isDataShape, PARTICIPANT_BAND } from '@core/document/outline.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import { idsIn } from '@canvas/study/elements.ts';
import type { Bounds, Point, RootElement, Scene, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { isRootElement } from '@canvas/study/scene.ts';
import { hostOf, isCollapsed, isExpanded } from '@canvas/study/tree.ts';

/** Room between layers and between rows, round what a container holds, between pools and round a group's shapes. */
const GAP_X = 60;
const GAP_Y = 40;
const PAD = 30;
const POOL_GAP = 40;
const GROUP_PAD = 20;
/** Room above an open sub-process's contents, for its name; how low a lane or pool with nothing in it is. */
const HEADER = 20;
const EMPTY_BAND = 120;
/** How wide the rows are that what no flow joins stands in, when it had no arrangement of its own. */
const KEPT_ROW = 800;

type Container = SceneNode | RootElement;

/** How far what goes with a shape (what sits on it, its caption and theirs) reaches past each side of its box. */
interface Reach {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const NO_REACH: Reach = { left: 0, top: 0, right: 0, bottom: 0 };

/** A band of rows: a lane, or a container that has none. */
interface Band {
  holder: Container;
  lane?: SceneNode;
}

/** The flow between a container's shapes: its sequence flows, and what must stand further right than each shape. */
interface Flow {
  next: Map<SceneNode, SceneNode[]>;
  prev: Map<SceneNode, SceneNode[]>;
  /** What a shape leads to or sends a message to, and the other way round. */
  after: Map<SceneNode, SceneNode[]>;
  before: Map<SceneNode, SceneNode[]>;
}

/** What containers hold, laid out: the room it takes, and where it goes once its corner is known. */
interface Laid {
  width: number;
  height: number;
  place(x: number, y: number): void;
}

/** Lay `scene` out afresh; what moved (shapes and pinned captions), for the caller to commit with the flows re-routed. */
export function layoutScene(scene: Scene): SceneElement[] {
  const nodes = [...scene.elementsById.values()].filter(isNode);
  const before = new Map(nodes.map((node) => [node, boxOf(node)] as const));
  const top = scene.rootElement.children.filter(isNode);
  const pools = top.filter((node) => node.type === 'bpmn:Participant').sort((a, b) => a.y - b.y);
  // Down the page: laid out across, on the shapes turned a quarter, and turned back.
  const down = pools.length === 0 && lanesOf(scene.rootElement).length === 0 && drawnDown(scene);
  const onPage = reaches(scene, nodes);
  const reach = down ? (node: SceneNode): Reach => turned(onPage(node)) : onPage;
  const roomsOf = (shapes: readonly SceneNode[]): Bounds[] => shapes.filter((node) => !isArtifact(node.type)).map((node) => roomOf(node, reach(node)));
  if (down) nodes.forEach(turn);

  const origin = cornerOf(roomsOf(top)) ?? { x: 100, y: 100 };
  layoutFlow(pools.length > 0 ? [...pools, scene.rootElement] : [scene.rootElement], reach).place(origin.x, origin.y);
  // A closed container's plane is drawn apart: laid out on its own, where it was.
  for (const node of nodes.filter(isCollapsed)) {
    const corner = cornerOf(roomsOf(node.children.filter(isNode)));
    if (corner) layoutFlow([node], reach).place(corner.x, corner.y);
  }
  if (down) nodes.forEach(turn);

  follow(scene, nodes, before, onPage);
  return [...nodes.filter((node) => !sameBox(node, before.get(node)!)), ...pinnedCaptions(scene, before)];
}

/** Lay out what `holders` hold as one flow, in bands: one to each lane, or to a holder without lanes. */
function layoutFlow(holders: readonly Container[], reach: (node: SceneNode) => Reach): Laid {
  const bands: Band[] = holders.flatMap((holder) => {
    const lanes = lanesOf(holder);
    return lanes.length > 0 ? lanes.map((lane) => ({ holder, lane })) : [{ holder }];
  });
  const laneBand = (node: SceneNode): number => {
    for (let p = node.parent; p; p = p.parent) {
      const at = bands.findIndex((band) => band.lane === p);
      if (at >= 0) return at;
    }
    return -1;
  };
  // A shape in no lane stands in its holder's first band.
  const holderBand = (node: SceneNode): number => {
    for (let p = node.parent; p; p = p.parent) {
      const at = bands.findIndex((band) => band.holder === p);
      if (at >= 0) return at;
    }
    return Math.max(0, bands.findIndex((band) => isRootElement(band.holder)));
  };
  const bandOf = (node: SceneNode): number => {
    const lane = laneBand(node);
    return lane >= 0 ? lane : holderBand(node);
  };

  const shapes = holders.flatMap(flowShapes);
  const flow = flowGraph(shapes, holders.flatMap(boundaryEvents));
  const loose = shapes.filter((shape) => flow.after.get(shape)!.length === 0 && flow.before.get(shape)!.length === 0 && shapes.length > 1);
  const placed = shapes.filter((shape) => !loose.includes(shape));
  const band = new Map(placed.map((shape) => [shape, bandOf(shape)] as const));
  // An open container is laid out inside first: that is its size.
  const insides = new Map(shapes.filter(isOpenContainer).map((shape) => [shape, layoutFlow([shape], reach)] as const));
  const sizeOf = (node: SceneNode): { width: number; height: number } => {
    const inside = insides.get(node);
    return inside ? { width: inside.width, height: inside.height + HEADER } : { width: node.width, height: node.height };
  };

  // A shape much wider than most spans the layers its room covers at their usual width (none past its own).
  const roomWidth = (shape: SceneNode): number => sizeOf(shape).width + reach(shape).left + reach(shape).right;
  const usual = median(placed.map(roomWidth));
  const span = new Map(placed.map((shape) => [shape, Math.max(0, Math.floor((roomWidth(shape) + GAP_X) / (usual + GAP_X)) - 1)] as const));
  const spanOf = (shape: SceneNode): number => span.get(shape) ?? 0;

  // Phases are laid out as flows of their own: the flows from one into the next set no layer.
  const phased = isPhased(bands, placed, flow, (node) => band.get(node)!);
  const layered = phased ? withinBands(flow, (node) => band.get(node)!) : flow;
  const layer = layersOf(placed, layered, (node) => band.get(node)!, spanOf);
  const row = rowsOf(placed, layer, layered, (node) => band.get(node)!, spanOf);
  const groups = phased ? bands.map((_, index) => placed.filter((shape) => band.get(shape) === index)) : [placed];
  const columns = new Map<SceneNode, Columns>();
  for (const members of groups) {
    const set = columnsOf(members, layer, spanOf, roomWidth, reach);
    for (const shape of members) columns.set(shape, set);
  }
  const flowWidth = Math.max(0, ...[...new Set(columns.values())].map((set) => set.width));
  const centreX = (shape: SceneNode): number => columns.get(shape)!.centreX(shape);

  // A data shape stands with the steps it links to, a lane's in its lane; what no flow joins, with its holder.
  const data = holders.flatMap(dataShapes);
  const linkedData = data.filter((node) => linkedShapes(node, placed).length > 0);
  const notes = holders.flatMap(holdings).filter((node) => node.type === 'bpmn:TextAnnotation' && node.incoming.length + node.outgoing.length === 0);
  const kept = [...loose, ...data.filter((node) => !linkedData.includes(node)), ...notes];
  const dataBand = (node: SceneNode): number => {
    const lane = laneBand(node);
    const linked = linkedShapes(node, placed).find((shape) => holderBand(shape) === holderBand(node));
    return lane >= 0 ? lane : linked ? band.get(linked)! : holderBand(node);
  };
  const wantedX = (node: SceneNode): number => {
    const linked = linkedShapes(node, placed);
    return linked.reduce((sum, shape) => sum + centreX(shape), 0) / linked.length;
  };

  // Per band: its rows, each as tall as its shapes and what goes with them, then its data row, then what it keeps.
  const framed = (b: Band): boolean => !!b.lane || (!isRootElement(b.holder) && !isCollapsed(b.holder));
  const leadOf = (b: Band): number => (isPool(b.holder) ? PARTICIPANT_BAND : 0) + PARTICIPANT_BAND * laneDepth(b.lane);
  const contentLeft = Math.max(0, ...bands.map((b) => leadOf(b) + (framed(b) ? PAD : 0)));
  const measured = bands.map((b, index) => {
    const members = placed.filter((shape) => band.get(shape) === index);
    const rows = Math.max(0, ...members.map((shape) => row.get(shape)! + 1));
    const north = Array.from({ length: rows }, () => 0);
    const south = Array.from({ length: rows }, () => 0);
    for (const shape of members) {
      const r = row.get(shape)!;
      north[r] = Math.max(north[r], sizeOf(shape).height / 2 + reach(shape).top);
      south[r] = Math.max(south[r], sizeOf(shape).height / 2 + reach(shape).bottom);
    }
    const line: number[] = [];
    let down = 0;
    for (let r = 0; r < rows; r += 1) {
      line[r] = down + north[r];
      down = line[r] + south[r] + GAP_Y;
    }
    const rowsHeight = rows > 0 ? down - GAP_Y : 0;
    const dataRow = linkedData.filter((node) => dataBand(node) === index).sort((p, q) => wantedX(p) - wantedX(q));
    const dataRooms = dataRow.map((node) => roomOf(node, reach(node)));
    const dataAt = spread(dataRooms.map((room, i) => ({ want: wantedX(dataRow[i]), size: room.width })));
    const dataHeight = Math.max(0, ...dataRooms.map((room) => room.height));
    const keep = kept.filter((node) => dataBand(node) === index);
    const keptBox = keep.length > 0 ? arrangement(keep, reach, Math.max(flowWidth, KEPT_ROW)) : undefined;
    const parts = [rowsHeight, dataHeight, keptBox?.height ?? 0].filter((height) => height > 0);
    const content = parts.reduce((sum, height) => sum + height + GAP_Y, -GAP_Y);
    const pad = framed(b) ? PAD : 0;
    const least = b.lane || isPool(b.holder) ? EMPTY_BAND : 0;
    const height = parts.length > 0 ? Math.max(least, pad + content + pad) : least;
    const dataWidth = Math.max(0, ...dataRooms.map((room, i) => dataAt[i] + room.width));
    return { members, line, rowsHeight, dataRow, dataRooms, dataAt, dataHeight, keep, keptBox, pad, height, width: Math.max(dataWidth, keptBox?.width ?? 0) };
  });
  const width = contentLeft + Math.max(flowWidth, ...measured.map((m) => m.width)) + (bands.some(framed) ? PAD : 0);
  const gaps = new Set(bands.filter((_, index) => measured[index].height > 0).map((b) => b.holder)).size - 1;
  const height = measured.reduce((sum, m) => sum + m.height, 0) + POOL_GAP * Math.max(0, gaps);

  return {
    width,
    height,
    place(x, y) {
      const left = x + contentLeft;
      let top = y;
      let holder: Container | undefined;
      let holderTop = y;
      const close = (): void => {
        if (holder && !isRootElement(holder) && isPool(holder)) setBox(holder, { x, y: holderTop, width, height: top - holderTop });
      };
      for (const [index, b] of bands.entries()) {
        const m = measured[index];
        if (m.height === 0) continue;
        if (b.holder !== holder) {
          close();
          if (holder) top += POOL_GAP;
          holder = b.holder;
          holderTop = top;
        }
        if (b.lane) {
          const indent = leadOf(b) - PARTICIPANT_BAND;
          setBox(b.lane, { x: x + indent, y: top, width: width - indent, height: m.height });
        }
        const rowsTop = top + m.pad;
        for (const shape of m.members) {
          const size = sizeOf(shape);
          const box = { x: left + centreX(shape) - size.width / 2, y: rowsTop + m.line[row.get(shape)!] - size.height / 2, ...size };
          setBox(shape, box);
          insides.get(shape)?.place(box.x, box.y + HEADER);
        }
        let below = rowsTop + m.rowsHeight + (m.rowsHeight > 0 ? GAP_Y : 0);
        // The data row: each data shape under the steps it links to, none on another.
        for (const [i, node] of m.dataRow.entries()) {
          const room = m.dataRooms[i];
          setBox(node, { x: left + m.dataAt[i] + node.x - room.x, y: below + node.y - room.y, width: node.width, height: node.height });
        }
        if (m.dataRow.length > 0) below += m.dataHeight + GAP_Y;
        // What no flow joins keeps its own arrangement, under the rest.
        for (const node of m.keep) {
          const at = m.keptBox!.at.get(node)!;
          const box = { x: left + at.x, y: below + at.y, ...sizeOf(node) };
          setBox(node, box);
          insides.get(node)?.place(box.x, box.y + HEADER);
        }
        top += m.height;
      }
      close();
      // A lane divided into lanes is drawn round them, deepest first.
      const divided = holders.flatMap(allLanes).filter((lane) => lane.children.some(isLane)).sort((p, q) => laneDepth(q) - laneDepth(p));
      for (const lane of divided) {
        const box = hull(lane.children.filter(isLane).map(boxOf));
        setBox(lane, { ...box, x: box.x - PARTICIPANT_BAND, width: box.width + PARTICIPANT_BAND });
      }
    },
  };
}

/**
 * Where things go along a line, in order, from 0 on: each as near as it can be to where it wants its middle, none on
 * another. A run that crowds together stands as one block round the middle of what it wants.
 */
function spread(items: readonly { want: number; size: number }[]): number[] {
  // Runs of items standing edge to edge; `sum` is what each item would have the run start at, summed.
  const runs: { first: number; count: number; size: number; sum: number; at: number }[] = [];
  for (const [i, item] of items.entries()) {
    let run = { first: i, count: 1, size: item.size, sum: item.want - item.size / 2, at: 0 };
    run.at = Math.max(0, run.sum);
    for (let last = runs.at(-1); last && last.at + last.size + GAP_X > run.at; last = runs.at(-1)) {
      runs.pop();
      const sum = last.sum + run.sum - run.count * (last.size + GAP_X);
      const count = last.count + run.count;
      run = { first: last.first, count, size: last.size + GAP_X + run.size, sum, at: Math.max(0, sum / count) };
    }
    runs.push(run);
  }
  const at: number[] = [];
  for (const run of runs) {
    let x = run.at;
    for (let i = run.first; i < run.first + run.count; i += 1) {
      at[i] = x;
      x += items[i].size + GAP_X;
    }
  }
  return at;
}

/**
 * Where each of `nodes` stands in a block of them, from the block's top left, and the block's size: as they stand
 * now, or in rows no wider than `across` when the shapes themselves lie on each other (as a drawing drafted at one
 * point has them; captions reaching over a neighbour are an arrangement still).
 */
function arrangement(nodes: readonly SceneNode[], reach: (node: SceneNode) => Reach, across: number): { at: Map<SceneNode, Point>; width: number; height: number } {
  const rooms = nodes.map((node) => roomOf(node, reach(node)));
  const at = new Map<SceneNode, Point>();
  if (!nodes.some((node, i) => nodes.slice(i + 1).some((other) => overlaps(node, other)))) {
    const box = hull(rooms);
    nodes.forEach((node) => at.set(node, { x: node.x - box.x, y: node.y - box.y }));
    return { at, width: box.width, height: box.height };
  }
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  nodes.forEach((node, i) => {
    const room = rooms[i];
    if (x > 0 && x + room.width > across) {
      x = 0;
      y += rowHeight + GAP_Y;
      rowHeight = 0;
    }
    at.set(node, { x: x + node.x - room.x, y: y + node.y - room.y });
    width = Math.max(width, x + room.width);
    rowHeight = Math.max(rowHeight, room.height);
    x += room.width + GAP_X;
  });
  return { at, width, height: y + rowHeight };
}

/** The flow between `shapes`: a boundary event's flows leave from its activity, and a message ends at a shape it reaches. */
function flowGraph(shapes: readonly SceneNode[], events: readonly SceneNode[]): Flow {
  const inFlow = new Set(shapes);
  const hosts = new Map(events.map((event) => [event, shapes.find((shape) => shape.id === idsIn(event.element.attachedToRef)[0])] as const));
  const shapeOf = (node: SceneNode | undefined): SceneNode | undefined => (node && hosts.has(node) ? hosts.get(node) : node && inFlow.has(node) ? node : undefined);
  const empty = (): Map<SceneNode, SceneNode[]> => new Map(shapes.map((shape) => [shape, [] as SceneNode[]] as const));
  const graph: Flow = { next: empty(), prev: empty(), after: empty(), before: empty() };
  for (const edge of [...shapes, ...events].flatMap((node) => node.outgoing)) {
    const source = shapeOf(edge.source);
    const target = shapeOf(edge.target);
    const sequence = isBpmnSubtypeOf(edge.type, 'bpmn:SequenceFlow');
    if (!source || !target || source === target || (!sequence && !isBpmnSubtypeOf(edge.type, 'bpmn:MessageFlow'))) continue;
    if (sequence) {
      graph.next.get(source)!.push(target);
      graph.prev.get(target)!.push(source);
    }
    graph.after.get(source)!.push(target);
    graph.before.get(target)!.push(source);
  }
  return graph;
}

/**
 * Each shape's first layer: one past the last layer of its own band that leads to it, and no earlier than any shape
 * that does, so a flow into another band may run straight down or up while a band's own flow always moves right. The
 * flows that loop back are set aside: first those the drawing shows going back within a band (their target wholly
 * before their source, and leading back to it), then any a search still finds. A start then moves up to just before
 * what it leads to.
 */
function layersOf(shapes: readonly SceneNode[], flow: Flow, bandOf: (node: SceneNode) => number, spanOf: (node: SceneNode) => number): Map<SceneNode, number> {
  const back = new Set<string>();
  for (const node of shapes) {
    for (const target of flow.after.get(node)!) {
      if (bandOf(target) === bandOf(node) && target.x + target.width < node.x && leadsTo(flow, target, node)) back.add(`${node.id}>${target.id}`);
    }
  }
  const state = new Map<SceneNode, 'open' | 'done'>();
  const finished: SceneNode[] = [];
  const byPlace = (a: SceneNode, b: SceneNode): number => a.x - b.x || a.y - b.y;
  const visit = (node: SceneNode): void => {
    state.set(node, 'open');
    for (const target of [...flow.after.get(node)!].sort(byPlace)) {
      if (back.has(`${node.id}>${target.id}`)) continue;
      if (state.get(target) === 'open') back.add(`${node.id}>${target.id}`);
      else if (!state.has(target)) visit(target);
    }
    state.set(node, 'done');
    finished.push(node);
  };
  const ordered = [...shapes].sort(byPlace);
  for (const node of ordered.filter((shape) => flow.before.get(shape)!.length === 0)) if (!state.has(node)) visit(node);
  for (const node of ordered) if (!state.has(node)) visit(node);

  const layer = new Map<SceneNode, number>();
  // The last layer of each band on some run of flows into a shape, the shape's own included.
  const last = new Map<SceneNode, Map<number, number>>();
  const order = finished.reverse();
  for (const node of order) {
    const into = flow.before.get(node)!.filter((source) => !back.has(`${source.id}>${node.id}`) && layer.has(source));
    const split = isExit(node, flow) ? flow.prev.get(node)![0] : undefined;
    const band = bandOf(node);
    const at = split ? layer.get(split)! : Math.max(0, ...into.map((source) => Math.max(layer.get(source)!, (last.get(source)!.get(band) ?? -1) + 1)));
    layer.set(node, at);
    const seen = new Map<number, number>();
    for (const source of into) for (const [b, l] of last.get(source)!) seen.set(b, Math.max(seen.get(b) ?? 0, l));
    last.set(node, seen.set(band, at + spanOf(node)));
  }
  for (const node of order.filter((shape) => flow.before.get(shape)!.length === 0)) {
    const out = flow.after.get(node)!.filter((target) => !back.has(`${node.id}>${target.id}`));
    if (out.length > 0) layer.set(node, Math.max(layer.get(node)!, Math.min(...out.map((target) => layer.get(target)!)) - 1 - spanOf(node)));
  }
  return layer;
}

/** Whether `from` leads to `to`, by any run of flows or messages. */
function leadsTo(flow: Flow, from: SceneNode, to: SceneNode): boolean {
  const seen = new Set([from]);
  for (const queue = [from]; queue.length > 0;) {
    for (const next of flow.after.get(queue.pop()!)!) {
      if (next === to) return true;
      if (!seen.has(next)) queue.push(seen.add(next) && next);
    }
  }
  return false;
}

/**
 * Whether the bands are the phases of one flow: lanes of one holder, which alone hold shapes, with flows from one
 * lane into another that all (a loop's return aside) lead into a later lane.
 */
function isPhased(bands: readonly Band[], shapes: readonly SceneNode[], flow: Flow, bandOf: (node: SceneNode) => number): boolean {
  const holder = bands.find((b) => b.lane)?.holder;
  if (!holder || shapes.some((shape) => bands[bandOf(shape)].holder !== holder || !bands[bandOf(shape)].lane)) return false;
  let handsOn = false;
  for (const source of shapes) {
    for (const target of flow.next.get(source)!) {
      if (bandOf(target) === bandOf(source) || leadsTo(flow, target, source)) continue;
      if (bandOf(target) < bandOf(source)) return false;
      handsOn = true;
    }
  }
  return handsOn;
}

/** `flow` without what runs from one band into another. */
function withinBands(flow: Flow, bandOf: (node: SceneNode) => number): Flow {
  const within = (links: Map<SceneNode, SceneNode[]>): Map<SceneNode, SceneNode[]> =>
    new Map([...links].map(([node, others]) => [node, others.filter((other) => bandOf(other) === bandOf(node))] as const));
  return { next: within(flow.next), prev: within(flow.prev), after: within(flow.after), before: within(flow.before) };
}

/** Where the layers of some shapes stand across, and how wide they are together. */
interface Columns {
  width: number;
  /** A shape's middle, from the left of the contents: its layer's middle line, or the middle of the layers it spans. */
  centreX(shape: SceneNode): number;
}

/**
 * The layers of `members`: each one's middle line from the left of the contents, the layer as wide as its widest
 * one-layer shape and what goes with it; the last layer a wider shape spans is widened, when they fall short of it.
 */
function columnsOf(
  members: readonly SceneNode[], layer: ReadonlyMap<SceneNode, number>, spanOf: (node: SceneNode) => number,
  roomWidth: (node: SceneNode) => number, reach: (node: SceneNode) => Reach,
): Columns {
  const layers = Math.max(0, ...members.map((shape) => layer.get(shape)! + spanOf(shape) + 1));
  const west = Array.from({ length: layers }, () => 0);
  const east = Array.from({ length: layers }, () => 0);
  for (const shape of members.filter((one) => spanOf(one) === 0)) {
    const l = layer.get(shape)!;
    const { left, right } = reach(shape);
    // Half the shape's own width, and what goes with it on each side.
    const half = (roomWidth(shape) - left - right) / 2;
    west[l] = Math.max(west[l], half + left);
    east[l] = Math.max(east[l], half + right);
  }
  const middle: number[] = [];
  let across = 0;
  const lineUp = (): void => {
    across = 0;
    for (let l = 0; l < layers; l += 1) {
      middle[l] = across + west[l];
      across = middle[l] + east[l] + GAP_X;
    }
  };
  lineUp();
  const reachOver = (shape: SceneNode): { from: number; to: number } => {
    const first = layer.get(shape)!;
    const end = first + spanOf(shape);
    return { from: middle[first] - west[first], to: middle[end] + east[end] };
  };
  for (const shape of members.filter((wide) => spanOf(wide) > 0).sort((p, q) => layer.get(p)! + spanOf(p) - layer.get(q)! - spanOf(q))) {
    const { from, to } = reachOver(shape);
    if (to - from >= roomWidth(shape)) continue;
    east[layer.get(shape)! + spanOf(shape)] += roomWidth(shape) - (to - from);
    lineUp();
  }
  return {
    width: layers > 0 ? across - GAP_X : 0,
    centreX(shape) {
      if (spanOf(shape) === 0) return middle[layer.get(shape)!];
      const { from, to } = reachOver(shape);
      return (from + to) / 2 + (reach(shape).left - reach(shape).right) / 2;
    },
  };
}

/** An end that one branch of a split runs into, and nothing else: it sits under the split, in the split's layer. */
function isExit(node: SceneNode, flow: Flow): boolean {
  const into = flow.prev.get(node)!;
  return isBpmnSubtypeOf(node.type, 'bpmn:EndEvent') && flow.next.get(node)!.length === 0 && into.length === 1
    && flow.next.get(into[0])!.length > 1;
}

/**
 * Each shape's row in its band: its predecessors' middle row when free (in every layer the shape spans), else the
 * nearest free one below, then above.
 */
function rowsOf(
  shapes: readonly SceneNode[], layer: ReadonlyMap<SceneNode, number>, flow: Flow, bandOf: (node: SceneNode) => number,
  spanOf: (node: SceneNode) => number,
): Map<SceneNode, number> {
  const row = new Map<SceneNode, number>();
  const taken = new Set<string>();
  const layers = Math.max(0, ...shapes.map((shape) => layer.get(shape)! + 1));
  for (let l = 0; l < layers; l += 1) {
    const wanted = (node: SceneNode): number => {
      const rows = flow.prev.get(node)!.filter((source) => row.has(source) && bandOf(source) === bandOf(node)).map((source) => row.get(source)!).sort((a, b) => a - b);
      return rows.length > 0 ? rows[Math.floor((rows.length - 1) / 2)] : 0;
    };
    const exit = (node: SceneNode): number => (isExit(node, flow) ? 1 : 0);
    const here = shapes.filter((shape) => layer.get(shape) === l)
      .sort((a, b) => bandOf(a) - bandOf(b) || exit(a) - exit(b) || wanted(a) - wanted(b) || firstOf(a, flow) - firstOf(b, flow) || a.y - b.y);
    for (const node of here) {
      // An exit wants its split's row, which it shares a layer with: it takes the free one under it.
      const want = exit(node) ? row.get(flow.prev.get(node)![0]) ?? 0 : wanted(node);
      const spanned = Array.from({ length: spanOf(node) + 1 }, (_, i) => l + i);
      const isFree = (r: number): boolean => spanned.every((m) => !taken.has(`${bandOf(node)}:${m}:${r}`));
      let at = want;
      for (let step = 0; !isFree(at); step += 1) at = step % 2 === 0 ? want + step / 2 + 1 : Math.max(0, want - (step + 1) / 2);
      for (const m of spanned) taken.add(`${bandOf(node)}:${m}:${at}`);
      row.set(node, at);
    }
  }
  return row;
}

/** Where a shape comes in its first predecessor's list of successors: which branch of a split it is. */
function firstOf(node: SceneNode, flow: Flow): number {
  const source = flow.prev.get(node)![0];
  return source ? flow.next.get(source)!.indexOf(node) : 0;
}

/** What follows the flow: a boundary event its activity, a note what it annotates, a group the shapes it held. */
function follow(scene: Scene, nodes: readonly SceneNode[], before: ReadonlyMap<SceneNode, Bounds>, reach: (node: SceneNode) => Reach): void {
  for (const node of nodes) {
    const host = hostOf(scene, node);
    if (!host) continue;
    // Where it sat on its activity's outline, kept as a share of the activity's size.
    const was = before.get(host)!;
    const at = centerOf(before.get(node)!);
    const share = { x: (at.x - was.x) / was.width, y: (at.y - was.y) / was.height };
    setBox(node, { ...boxOf(node), x: host.x + share.x * host.width - node.width / 2, y: host.y + share.y * host.height - node.height / 2 });
  }
  for (const note of nodes.filter((node) => node.type === 'bpmn:TextAnnotation')) {
    const link = [...note.incoming, ...note.outgoing][0];
    const other = link && (link.source === note ? link.target : link.source);
    if (!other) continue;
    const by = delta(other, before);
    const was = before.get(note)!;
    setBox(note, { ...was, x: was.x + by.x, y: was.y + by.y });
  }
  for (const group of nodes.filter((node) => node.type === 'bpmn:Group')) {
    const was = before.get(group)!;
    // What it held: what stood inside it, and what its category names.
    const [value] = idsIn(group.element.categoryValueRef);
    const named = (node: SceneNode): boolean => !!value && idsIn(node.element.categoryValueRef).includes(value);
    const members = nodes.filter((node) => node.type !== 'bpmn:Group' && !isLane(node) && !isPool(node) && (inside(was, centerOf(before.get(node)!)) || named(node)));
    if (members.length === 0) continue;
    // Shapes that kept their arrangement keep their group as it was drawn; else it is drawn round them afresh.
    const by = members.map((node) => delta(node, before));
    if (by.every((d) => d.x === by[0].x && d.y === by[0].y)) {
      setBox(group, { ...was, x: was.x + by[0].x, y: was.y + by[0].y });
      continue;
    }
    const box = hull(members.map((node) => roomOf(node, reach(node))));
    setBox(group, { x: box.x - GROUP_PAD, y: box.y - GROUP_PAD, width: box.width + 2 * GROUP_PAD, height: box.height + 2 * GROUP_PAD });
  }
}

/**
 * Pinned captions, which stay put as their owners move: a shape's goes with it; a flow's is let go, to be placed
 * afresh on the route the flow gets.
 */
function pinnedCaptions(scene: Scene, before: ReadonlyMap<SceneNode, Bounds>): SceneElement[] {
  const moved: SceneElement[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'label' || !element.pinned) continue;
    if (element.owner.kind === 'edge') {
      element.pinned = false;
      moved.push(element);
      continue;
    }
    const by = delta(element.owner, before);
    if (by.x === 0 && by.y === 0) continue;
    element.x += by.x;
    element.y += by.y;
    moved.push(element);
  }
  return moved;
}

/** Whether the root's flow runs down the page: its last layer sits further below its first than beside it. */
function drawnDown(scene: Scene): boolean {
  const shapes = flowShapes(scene.rootElement);
  const flow = flowGraph(shapes, boundaryEvents(scene.rootElement));
  const joined = shapes.filter((shape) => flow.after.get(shape)!.length > 0 || flow.before.get(shape)!.length > 0);
  const layer = layersOf(joined, flow, () => 0, () => 0);
  const middleOf = (l: number): Point => {
    const points = joined.filter((shape) => layer.get(shape) === l).map(centerOf);
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  };
  const last = Math.max(0, ...layer.values());
  if (last === 0) return false;
  const first = middleOf(Math.min(...layer.values()));
  const end = middleOf(last);
  return Math.abs(end.y - first.y) > Math.abs(end.x - first.x);
}

// --- what a container holds -------------------------------------------------------

/** The container's lanes, top to bottom; a lane divided into lanes gives its own. */
function lanesOf(container: Container): SceneNode[] {
  return allLanes(container).filter((lane) => !lane.children.some(isLane));
}

/** Every lane in the container, a divided lane before the lanes it holds, top to bottom. */
function allLanes(container: Container): SceneNode[] {
  return container.children.filter(isLane).sort((a, b) => a.y - b.y).flatMap((lane) => [lane, ...allLanes(lane)]);
}

/** How many lanes deep a lane sits, itself counted; none is 0. */
function laneDepth(lane: SceneNode | undefined): number {
  let depth = 0;
  for (let p = lane; p && isLane(p); p = p.parent) depth += 1;
  return depth;
}

/** The shapes of the container's flow, its lanes' included: not pools, lanes, notes, groups, data or what sits on an activity. */
function flowShapes(container: Container): SceneNode[] {
  return holdings(container).filter((child) => !isPool(child) && !isArtifact(child.type) && !isDataShape(child.type) && !child.element.attachedToRef);
}

function dataShapes(container: Container): SceneNode[] {
  return holdings(container).filter((child) => isDataShape(child.type));
}

/** What sits on the container's activities, its lanes' included. */
function boundaryEvents(container: Container): SceneNode[] {
  return holdings(container).filter((child) => !!child.element.attachedToRef);
}

/** The shapes the container holds, its lanes' included, not the lanes. */
function holdings(container: Container): SceneNode[] {
  return container.children.filter(isNode).flatMap((child) => (isLane(child) ? holdings(child) : [child]));
}

/** The shapes of `among` a data shape (or a loose shape) is joined to, by any flow or association. */
function linkedShapes(node: SceneNode, among: readonly SceneNode[]): SceneNode[] {
  const ends = [...node.incoming.map((edge) => edge.source), ...node.outgoing.map((edge) => edge.target)];
  return among.filter((shape) => ends.includes(shape));
}

/** How far each shape's boundary events and captions reach past its box, as the shapes stand now. */
function reaches(scene: Scene, nodes: readonly SceneNode[]): (node: SceneNode) => Reach {
  const onIt = new Map<SceneNode, SceneNode[]>();
  for (const node of nodes) {
    const host = hostOf(scene, node);
    if (host) onIt.set(host, [...(onIt.get(host) ?? []), node]);
  }
  const reach = new Map(nodes.map((node) => {
    const all = hull([node, ...(onIt.get(node) ?? [])].flatMap((shape) => (shape.label ? [boxOf(shape), shape.label] : [boxOf(shape)])));
    return [node, { left: node.x - all.x, top: node.y - all.y, right: all.x + all.width - node.x - node.width, bottom: all.y + all.height - node.y - node.height }] as const;
  }));
  return (node) => reach.get(node) ?? NO_REACH;
}

/** A shape's box with the room what goes with it takes. */
function roomOf(node: SceneNode, reach: Reach): Bounds {
  return { x: node.x - reach.left, y: node.y - reach.top, width: node.width + reach.left + reach.right, height: node.height + reach.top + reach.bottom };
}

/** A reach turned a quarter, as `turn` turns a shape. */
function turned(reach: Reach): Reach {
  return { left: reach.top, top: reach.left, right: reach.bottom, bottom: reach.right };
}

/** A shape turned a quarter about the page's diagonal: across becomes down. */
function turn(node: SceneNode): void {
  [node.x, node.y, node.width, node.height] = [node.y, node.x, node.height, node.width];
}

function isOpenContainer(node: SceneNode): boolean {
  return isExpanded(node) && node.children.some(isNode);
}

function isArtifact(type: string): boolean {
  return type === 'bpmn:TextAnnotation' || type === 'bpmn:Group';
}

function isLane(element: SceneElement): element is SceneNode {
  return element.kind === 'node' && element.type === 'bpmn:Lane';
}

function isPool(container: Container): boolean {
  return !isRootElement(container) && container.type === 'bpmn:Participant';
}

// --- geometry -------------------------------------------------------------------

function isNode(element: SceneElement): element is SceneNode {
  return element.kind === 'node';
}

function boxOf(node: SceneNode): Bounds {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function setBox(node: SceneNode, box: Bounds): void {
  node.x = Math.round(box.x);
  node.y = Math.round(box.y);
  node.width = Math.round(box.width);
  node.height = Math.round(box.height);
}

function sameBox(node: SceneNode, box: Bounds): boolean {
  return node.x === box.x && node.y === box.y && node.width === box.width && node.height === box.height;
}

function delta(node: SceneNode, before: ReadonlyMap<SceneNode, Bounds>): Point {
  const was = before.get(node)!;
  return { x: node.x - was.x, y: node.y - was.y };
}

function cornerOf(boxes: readonly Bounds[]): Point | undefined {
  return boxes.length === 0 ? undefined : { x: Math.min(...boxes.map((box) => box.x)), y: Math.min(...boxes.map((box) => box.y)) };
}

function hull(boxes: readonly Bounds[]): Bounds {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(box: Bounds, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}
