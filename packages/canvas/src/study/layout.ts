/**
 * Layout: lay a diagram out afresh, as the study's `layout` verb does. The flow runs left to right in layers: a shape
 * sits one layer past the longest run of flows into it, with loops set aside; a start sits just before what it leads
 * to, and an end that one branch of a split runs into sits under the split. The pools of a collaboration share their
 * layers, a message counting as a flow, so what one pool sends stands before what another does with it. A flow drawn
 * down the page, with no pools or lanes, is laid out down the page.
 *
 * The shapes of a layer stand in rows, each taking its predecessors' row where it is free, so a chain keeps to one
 * line and a branch drops below. A shape takes room for what goes with it: what sits on it, its caption and theirs.
 * A lane is a band of such rows, a pool a stack of lanes, and pools stack down the page, all as wide as the widest.
 * An open sub-process is laid out inside first and then placed like any shape; a closed one's plane is laid out apart.
 * A data shape stands in a row under the steps it feeds or takes from; the shapes no flow reaches keep their own
 * arrangement under that. A boundary event keeps its place on its activity, a note its place beside what it
 * annotates, and a group is drawn round the shapes it held.
 *
 * Shapes keep their sizes; containers are sized round what they hold. Pure geometry on the scene: it writes the boxes
 * and returns what it moved, for the caller to route the flows afresh and commit.
 */

import { centerOf, isDataShape, PARTICIPANT_BAND } from '@core/document/outline.ts';
import { getProperty } from '@core/element/moddle.ts';
import { isBpmnSubtypeOf } from '@core/notation/bpmn.ts';

import type { Bounds, ModdleObject, Point, RootElement, Scene, SceneElement, SceneNode } from '@canvas/study/scene.ts';
import { isRootElement } from '@canvas/study/scene.ts';
import { isCollapsed, isExpanded } from '@canvas/study/tree.ts';

/** Room between layers and between rows, round what a container holds, between pools and round a group's shapes. */
const GAP_X = 60;
const GAP_Y = 40;
const PAD = 30;
const POOL_GAP = 40;
const GROUP_PAD = 20;
/** Room above an open sub-process's contents, for its name; how low a lane or pool with nothing in it is. */
const HEADER = 20;
const EMPTY_BAND = 120;

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

/** Lay out what `holders` hold as one flow in shared layers, in bands: one to each lane, or to a holder without lanes. */
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

  // Each layer's middle line, from the left of the contents, the layer as wide as its widest shape and what goes with it.
  const layer = layersOf(placed, flow, (node) => band.get(node)!);
  const row = rowsOf(placed, layer, flow, (node) => band.get(node)!);
  const layers = Math.max(0, ...placed.map((shape) => layer.get(shape)! + 1));
  const west = Array.from({ length: layers }, () => 0);
  const east = Array.from({ length: layers }, () => 0);
  for (const shape of placed) {
    const l = layer.get(shape)!;
    west[l] = Math.max(west[l], sizeOf(shape).width / 2 + reach(shape).left);
    east[l] = Math.max(east[l], sizeOf(shape).width / 2 + reach(shape).right);
  }
  const middle: number[] = [];
  let across = 0;
  for (let l = 0; l < layers; l += 1) {
    middle[l] = across + west[l];
    across = middle[l] + east[l] + GAP_X;
  }
  const flowWidth = layers > 0 ? across - GAP_X : 0;

  // A data shape stands with the steps it links to, a lane's in its lane; what no flow joins, with its holder.
  const data = holders.flatMap(dataShapes);
  const linkedData = data.filter((node) => linkedShapes(node, placed).length > 0);
  const kept = [...loose, ...data.filter((node) => !linkedData.includes(node))];
  const dataBand = (node: SceneNode): number => {
    const lane = laneBand(node);
    const linked = linkedShapes(node, placed).find((shape) => holderBand(shape) === holderBand(node));
    return lane >= 0 ? lane : linked ? band.get(linked)! : holderBand(node);
  };
  const wantedX = (node: SceneNode): number => {
    const linked = linkedShapes(node, placed);
    return linked.reduce((sum, shape) => sum + middle[layer.get(shape)!], 0) / linked.length;
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
    const keptBox = keep.length > 0 ? hull(keep.map((node) => roomOf(node, reach(node)))) : undefined;
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
          const box = { x: left + middle[layer.get(shape)!] - size.width / 2, y: rowsTop + m.line[row.get(shape)!] - size.height / 2, ...size };
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
        const keptBox = m.keptBox;
        for (const node of keptBox ? m.keep : []) {
          const box = { x: left + node.x - keptBox!.x, y: below + node.y - keptBox!.y, ...sizeOf(node) };
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

/** The flow between `shapes`: a boundary event's flows leave from its activity, and a message ends at a shape it reaches. */
function flowGraph(shapes: readonly SceneNode[], events: readonly SceneNode[]): Flow {
  const inFlow = new Set(shapes);
  const hosts = new Map(events.map((event) => [event, shapes.find((shape) => shape.businessObject === getProperty(event.businessObject, 'attachedToRef'))] as const));
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
 * Each shape's layer: one past the last shape of its own band that leads to it, and no earlier than any shape that
 * does, so a flow into another band may run straight down or up while a band's own flow always moves right. The flows
 * that loop back are set aside (the ones drawn going back, where the drawing tells). A start then moves up to just
 * before what it leads to.
 */
function layersOf(shapes: readonly SceneNode[], flow: Flow, bandOf: (node: SceneNode) => number): Map<SceneNode, number> {
  const back = new Set<string>();
  const state = new Map<SceneNode, 'open' | 'done'>();
  const finished: SceneNode[] = [];
  const byPlace = (a: SceneNode, b: SceneNode): number => a.x - b.x || a.y - b.y;
  const visit = (node: SceneNode): void => {
    state.set(node, 'open');
    for (const target of [...flow.after.get(node)!].sort(byPlace)) {
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
    last.set(node, seen.set(band, at));
  }
  for (const node of order.filter((shape) => flow.before.get(shape)!.length === 0)) {
    const out = flow.after.get(node)!.filter((target) => !back.has(`${node.id}>${target.id}`));
    if (out.length > 0) layer.set(node, Math.max(layer.get(node)!, Math.min(...out.map((target) => layer.get(target)!)) - 1));
  }
  return layer;
}

/** An end that one branch of a split runs into, and nothing else: it sits under the split, in the split's layer. */
function isExit(node: SceneNode, flow: Flow): boolean {
  const into = flow.prev.get(node)!;
  return isBpmnSubtypeOf(node.type, 'bpmn:EndEvent') && flow.next.get(node)!.length === 0 && into.length === 1
    && flow.next.get(into[0])!.length > 1;
}

/** Each shape's row in its band: its predecessors' middle row when free, else the nearest free one below, then above. */
function rowsOf(
  shapes: readonly SceneNode[], layer: ReadonlyMap<SceneNode, number>, flow: Flow, bandOf: (node: SceneNode) => number,
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
      let at = want;
      for (let step = 0; taken.has(`${bandOf(node)}:${l}:${at}`); step += 1) at = step % 2 === 0 ? want + step / 2 + 1 : Math.max(0, want - (step + 1) / 2);
      taken.add(`${bandOf(node)}:${l}:${at}`);
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
    const members = nodes.filter((node) => node.type !== 'bpmn:Group' && !isLane(node) && !isPool(node) && inside(was, centerOf(before.get(node)!)));
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
  const layer = layersOf(joined, flow, () => 0);
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
  return holdings(container).filter((child) => !isPool(child) && !isArtifact(child.type) && !isDataShape(child.type) && !getProperty(child.businessObject, 'attachedToRef'));
}

function dataShapes(container: Container): SceneNode[] {
  return holdings(container).filter((child) => isDataShape(child.type));
}

/** What sits on the container's activities, its lanes' included. */
function boundaryEvents(container: Container): SceneNode[] {
  return holdings(container).filter((child) => !!getProperty(child.businessObject, 'attachedToRef'));
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

/** The activity a boundary event sits on. */
function hostOf(scene: Scene, node: SceneNode): SceneNode | undefined {
  const host = scene.byBusinessObject.get(getProperty(node.businessObject, 'attachedToRef') as ModdleObject);
  return host?.kind === 'node' ? host : undefined;
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

function inside(box: Bounds, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}
