
import { expect, test } from '@playwright/test';

import type { Canvas } from '@canvas/index.ts';
import { readColorsOf } from '@canvas/model/color.ts';
import { isHiddenByCollapse } from '@canvas/model/expand.ts';
import type { Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';

import { freshModdle, loadCanvas } from './canvasHarness';
import { exampleNames, exampleXml } from './utils';

/**
 * P5 milestone (design §6): **structural round-trip completeness** over all 18
 * shipped examples.
 *
 * Two questions per example, both answered against `bpmn-moddle`'s `toXML` of the
 * SAME live tree the canvas imported — never against the scene graph:
 *
 * 1. **no-op round trip** — importing a document and serializing it again must
 *    yield a structurally identical document. Not a string compare: both sides are
 *    re-parsed and reduced to a canonical structure (every business object with its
 *    type, containment slot, scalar attributes and *references*; every `BPMNShape`
 *    with its plane, `dc:Bounds`, `isExpanded`/`isMarkerVisible` and colour
 *    attributes; every `BPMNEdge` with its plane and `di:waypoint` list), so
 *    attribute order and formatting are free but a single dropped reference is not.
 *    This is the regression net for import fidelity: the importer resolves refs,
 *    splices nested planes and derives containment, and none of that may write.
 *
 * 2. **edit round trip** — programmatic edits spanning P3–P5 (move, rename,
 *    create + connect, data association, colour, delete), each snapshotted before
 *    and after and diffed, and finally a save→load→save fixed-point check. The
 *    assertion is not "the edit happened" but **"exactly this changed and nothing
 *    else did"**: the diff's added/removed id sets and its per-element
 *    changed-field sets must equal a set computed independently from the scene, so
 *    an unrelated shape's bounds drifting by one, a stale `sourceRef`, a lost
 *    `flowNodeRef` or an orphaned `planeElement` fails the test even though the
 *    intended edit succeeded.
 *
 * A step whose feature an example does not offer (no data object to associate, no
 * free room to drop a shape, no pair the rules will connect) is skipped and logged
 * rather than failed; every run also prints a `COVER` line per example naming what
 * it actually exercised.
 */

// --- canonical structure -----------------------------------------------------

/** A flattened record: `flat key → canonical JSON`, so a diff names the exact field. */
type Flat = Map<string, string>;
/** `element id → flattened record`. */
type Table = Map<string, Flat>;

interface Structure {
  /** Every business object, keyed by id. */
  bo: Table;
  /** Every `bpmndi:BPMNShape`, keyed by the id of the business object it depicts. */
  shapes: Table;
  /** Every `bpmndi:BPMNEdge`, keyed by the id of the business object it depicts. */
  edges: Table;
  /** One canonical line per `bpmndi:BPMNDiagram`. */
  planes: string[];
}

function isModdle(value: unknown): value is Record<string, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $type?: unknown }).$type === 'string'
  );
}

/**
 * Split a moddle object into its scalar attributes, its **references** and its
 * contained children, driven by the moddle **descriptor** rather than by
 * `Object.keys`.
 *
 * This distinction is the whole point of the extractor. `bpmn-moddle` materializes
 * resolved reference properties (`sourceRef`, `outgoing`, `incoming`, `default`,
 * `flowNodeRef`, `processRef`, …) as **non-enumerable** own properties, so an
 * `Object.entries` walk cannot see any of them — and a round-trip check that cannot
 * see references is a round-trip check that cannot fail. `$descriptor.properties`
 * lists every declared property with `isReference`/`isMany`, which is exactly the
 * classification needed: references become id lists (never followed, so a walk of
 * the containment tree stays a tree), children are recursed into, everything else
 * is a scalar.
 */
interface Split {
  attrs: Record<string, unknown>;
  refs: Record<string, string | string[]>;
  children: { slot: string; item: Record<string, any> }[];
}

const REF_NAME = (value: Record<string, any>): string =>
  typeof value.id === 'string' ? value.id : `<${value.$type}>`;

function splitOf(obj: Record<string, any>): Split {
  const attrs: Record<string, unknown> = {};
  const refs: Record<string, string | string[]> = {};
  const children: { slot: string; item: Record<string, any> }[] = [];
  const declared = new Set<string>(['id']);

  for (const property of (obj.$descriptor?.properties ?? []) as any[]) {
    const name: string = property.name;
    declared.add(name);
    const value = obj[name];
    if (value === undefined || value === null) continue;
    // The DI subtree is snapshotted separately, plane by plane.
    if (name === 'diagrams' && obj.$type === 'bpmn:Definitions') continue;

    if (property.isReference) {
      const list = (Array.isArray(value) ? value : [value]).filter(isModdle);
      if (list.length === 0) continue;
      refs[name] = property.isMany ? list.map(REF_NAME) : REF_NAME(list[0]);
      continue;
    }
    const items = Array.isArray(value) ? value : [value];
    if (items.some(isModdle)) {
      for (const item of items) if (isModdle(item)) children.push({ slot: name, item });
      continue;
    }
    if (name !== 'id') attrs[name] = property.isMany ? items : items[0];
  }

  // Own properties the descriptor does not declare, plus the raw `$attrs` bag a
  // bare moddle keeps unregistered namespaced attributes in. `xmlns*` declarations
  // are excluded: which prefixes a writer emits is a serialization detail (pinned
  // by `canvas-color.unit.spec.ts`), not part of the document's structure.
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$') || declared.has(key)) continue;
    if (value === undefined || typeof value === 'object' || key.startsWith('xmlns')) continue;
    attrs[key] = value;
  }
  const raw = obj.$attrs;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'object' || key.startsWith('xmlns')) continue;
      attrs[`$attrs.${key}`] = value;
    }
  }
  return { attrs, refs, children };
}

function attrsOf(obj: Record<string, any>): Record<string, unknown> {
  return splitOf(obj).attrs;
}

/**
 * The id-less contained subtree of `obj` (`extensionElements`, `documentation`,
 * `conditionExpression`, …) — anything with an id is recorded as its own row.
 */
function localOf(obj: Record<string, any>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const { slot, item } of splitOf(obj).children) {
    if (typeof item.id === 'string') continue;
    const split = splitOf(item);
    (out[slot] ??= []).push({
      type: item.$type,
      attrs: split.attrs,
      refs: split.refs,
      local: localOf(item),
    });
  }
  return out;
}

/** Flatten a record into `field → canonical JSON`, one entry per attribute/reference. */
function flatten(fields: Record<string, unknown>): Flat {
  const flat: Flat = new Map();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if ((key === 'attrs' || key === 'refs') && value && typeof value === 'object') {
      for (const [inner, own] of Object.entries(value as Record<string, unknown>)) {
        flat.set(`${key}.${inner}`, JSON.stringify(own));
      }
      continue;
    }
    flat.set(key, JSON.stringify(value));
  }
  return flat;
}

/** Walk the business-object containment tree (never the DI subtree) into `table`. */
function walkBO(
  obj: Record<string, any>,
  owner: string | undefined,
  slot: string | undefined,
  table: Table,
): void {
  const id = typeof obj.id === 'string' ? obj.id : undefined;
  const split = splitOf(obj);
  if (id !== undefined) {
    table.set(
      id,
      flatten({
        type: obj.$type,
        parent: owner ?? null,
        slot: slot ?? null,
        attrs: split.attrs,
        refs: split.refs,
        local: localOf(obj),
      }),
    );
  }
  for (const child of split.children) {
    walkBO(
      child.item,
      id ?? owner,
      id === undefined && slot ? `${slot}/${child.slot}` : child.slot,
      table,
    );
  }
}

function boundsOf(bounds: unknown): unknown {
  if (!isModdle(bounds)) return null;
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function labelOf(di: Record<string, any>): unknown {
  const label = di.label;
  if (!isModdle(label)) return null;
  return { bounds: boundsOf(label.bounds), attrs: attrsOf(label) };
}

/** Reduce a `bpmn:Definitions` moddle tree to its canonical {@link Structure}. */
function structureOf(definitions: Record<string, any>): Structure {
  const bo: Table = new Map();
  walkBO(definitions, undefined, undefined, bo);

  const shapes: Table = new Map();
  const edges: Table = new Map();
  const planes: string[] = [];
  for (const diagram of definitions.diagrams ?? []) {
    const plane = diagram.plane;
    if (!isModdle(plane)) continue;
    const planeId = (plane.id as string | undefined) ?? (diagram.id as string | undefined) ?? '?';
    planes.push(
      JSON.stringify({
        diagram: diagram.id ?? null,
        plane: planeId,
        root: isModdle(plane.bpmnElement) ? (plane.bpmnElement.id ?? null) : null,
      }),
    );
    for (const pe of plane.planeElement ?? []) {
      if (!isModdle(pe) || !isModdle(pe.bpmnElement)) continue;
      const key = pe.bpmnElement.id as string | undefined;
      if (!key) continue;
      const split = splitOf(pe);
      const { bpmnElement: _drawn, ...refs } = split.refs;
      if (pe.$type === 'bpmndi:BPMNShape') {
        shapes.set(
          key,
          flatten({
            diId: pe.id ?? null,
            plane: planeId,
            bounds: boundsOf(pe.bounds),
            label: labelOf(pe),
            attrs: split.attrs,
            refs,
          }),
        );
      } else if (pe.$type === 'bpmndi:BPMNEdge') {
        edges.set(
          key,
          flatten({
            diId: pe.id ?? null,
            plane: planeId,
            waypoints: (pe.waypoint ?? []).map((w: any) => ({ x: w.x, y: w.y })),
            label: labelOf(pe),
            attrs: split.attrs,
            refs,
          }),
        );
      }
    }
  }
  return { bo, shapes, edges, planes };
}

// --- structural diff ---------------------------------------------------------

interface TableDiff {
  added: string[];
  removed: string[];
  /** `id → the flat field names whose canonical value differs`. */
  changed: Map<string, string[]>;
}

function diffTable(before: Table, after: Table): TableDiff {
  const added = [...after.keys()].filter((id) => !before.has(id)).sort();
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
  const changed = new Map<string, string[]>();
  for (const [id, a] of before) {
    const b = after.get(id);
    if (!b) continue;
    const keys = new Set([...a.keys(), ...b.keys()]);
    const differing = [...keys].filter((key) => a.get(key) !== b.get(key)).sort();
    if (differing.length > 0) changed.set(id, differing);
  }
  return { added, removed, changed };
}

interface Delta {
  bo: TableDiff;
  shapes: TableDiff;
  edges: TableDiff;
  planes: { before: string[]; after: string[] };
}

function deltaOf(before: Structure, after: Structure): Delta {
  return {
    bo: diffTable(before.bo, after.bo),
    shapes: diffTable(before.shapes, after.shapes),
    edges: diffTable(before.edges, after.edges),
    planes: { before: before.planes, after: after.planes },
  };
}

/** Render a diff as sorted plain data, so a failure message names the drift. */
function plain(diff: TableDiff): unknown {
  return {
    added: diff.added,
    removed: diff.removed,
    changed: Object.fromEntries([...diff.changed].sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Every business-object row contained (at any depth) by one of `roots` — the ided
 * objects the scene graph does not model but a delete still has to take: an
 * `ErrorEventDefinition` under a boundary event, a `DataInput` under an
 * `ioSpecification`, and so on.
 */
function descendantRows(structure: Structure, roots: readonly string[]): string[] {
  const set = new Set(roots);
  const out: string[] = [];
  for (const [id, row] of structure.bo) {
    if (set.has(id)) continue;
    let cursor: string | undefined = JSON.parse(row.get('parent') ?? 'null') ?? undefined;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      if (set.has(cursor)) {
        out.push(id);
        break;
      }
      guard.add(cursor);
      const parent = structure.bo.get(cursor);
      cursor = parent ? (JSON.parse(parent.get('parent') ?? 'null') ?? undefined) : undefined;
    }
  }
  return out;
}

interface Expectation {
  added?: string[];
  removed?: string[];
  changed?: Record<string, string[]>;
}

function expectTable(label: string, diff: TableDiff, expected: Expectation): void {
  expect(plain(diff), label).toEqual({
    added: [...(expected.added ?? [])].sort(),
    removed: [...(expected.removed ?? [])].sort(),
    changed: Object.fromEntries(
      Object.entries(expected.changed ?? {})
        .map(([id, keys]) => [id, [...keys].sort()] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

// --- scene helpers (independent of the code under test) ----------------------

const CONTAINER_TYPES = new Set(['bpmn:Participant', 'bpmn:Lane']);
const ARTIFACT_TYPES = new Set(['bpmn:Group', 'bpmn:TextAnnotation']);
const DATA_TYPES = new Set(['bpmn:DataObjectReference', 'bpmn:DataStoreReference']);

function isNode(element: SceneElement | undefined): element is SceneNode {
  return element?.kind === 'node';
}

/** Every visible leaf shape, in id order — the pool of edit targets. */
function leafNodes(canvas: Canvas): SceneNode[] {
  const scene = canvas.getScene();
  if (!scene) return [];
  const out: SceneNode[] = [];
  for (const element of scene.elementsById.values()) {
    if (!isNode(element as SceneElement)) continue;
    const node = element as SceneNode;
    if (!node.di) continue;
    if (node.children.length > 0) continue;
    if (CONTAINER_TYPES.has(node.type) || ARTIFACT_TYPES.has(node.type)) continue;
    if (isHiddenByCollapse(node)) continue;
    out.push(node);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Edges whose docking waypoint a move of `node` drags along (`dockConnectedEdges`). */
function dockedEdges(node: SceneNode): SceneEdge[] {
  const out: SceneEdge[] = [];
  for (const edge of [...node.outgoing, ...node.incoming]) {
    if (edge.waypoints.length === 0 || !edge.di) continue;
    if (!out.includes(edge)) out.push(edge);
  }
  return out;
}

/** Whether a move of `node` writes a `bpmndi:BPMNLabel` position too. */
function hasPlacedLabel(element: SceneElement): boolean {
  const label = element.label;
  return !!label && !!label.di && label.x !== undefined && label.y !== undefined;
}

/**
 * The closure a delete of `seed` must remove, derived from the scene here rather
 * than from `collectRemoval` (which is the code under test): the node, the boundary
 * events attached to it, and every edge incident to any of those.
 */
function boundaryEventsOf(canvas: Canvas, host: SceneNode): SceneNode[] {
  const scene = canvas.getScene();
  if (!scene) return [];
  const out: SceneNode[] = [];
  for (const element of scene.elementsById.values()) {
    if (!isNode(element as SceneElement)) continue;
    const node = element as SceneNode;
    const attached = node.businessObject.attachedToRef;
    if (isModdle(attached) && attached === host.businessObject) out.push(node);
  }
  return out;
}

function deletionClosure(canvas: Canvas, seed: SceneNode): { nodes: SceneNode[]; edges: SceneEdge[] } {
  const nodes: SceneNode[] = [seed, ...boundaryEventsOf(canvas, seed)];
  const edges: SceneEdge[] = [];
  for (const node of nodes) {
    for (const edge of [...node.outgoing, ...node.incoming]) {
      if (!edges.includes(edge)) edges.push(edge);
    }
  }
  return { nodes, edges };
}

/** The nearest enclosing `bpmn:Lane` of `node`, if any (pools file members by ref). */
function laneOf(node: SceneNode | undefined): SceneNode | undefined {
  let cursor: SceneNode | undefined = node;
  const guard = new Set<SceneNode>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    if (cursor.type === 'bpmn:Lane') return cursor;
    cursor = cursor.parent;
  }
  return undefined;
}

const NEW_SHAPE = { width: 100, height: 80 };

/**
 * A diagram point where a `NEW_SHAPE`-sized drop lands inside `host` (or, with no
 * host, outside every shape) — centre *and* four corners must resolve to `host`, so
 * the new shape does not straddle a sibling. `undefined` when there is no room.
 */
function freeDropPoint(canvas: Canvas, host: SceneNode | undefined): Point | undefined {
  const halfW = NEW_SHAPE.width / 2 + 8;
  const halfH = NEW_SHAPE.height / 2 + 8;
  const lands = (point: Point): boolean => {
    const probes: Point[] = [
      point,
      { x: point.x - halfW, y: point.y - halfH },
      { x: point.x + halfW, y: point.y - halfH },
      { x: point.x - halfW, y: point.y + halfH },
      { x: point.x + halfW, y: point.y + halfH },
    ];
    return probes.every((probe) => {
      const hit = canvas.hitTest(probe);
      const container = hit === undefined ? undefined : isNode(hit) ? hit : hit.parent;
      return container === host;
    });
  };

  if (host) {
    for (let y = host.y + halfH; y <= host.y + host.height - halfH; y += 20) {
      for (let x = host.x + halfW; x <= host.x + host.width - halfW; x += 20) {
        if (lands({ x, y })) return { x, y };
      }
    }
    return undefined;
  }

  const scene = canvas.getScene();
  if (!scene) return undefined;
  let maxX = 0;
  let minY = 0;
  let seen = false;
  for (const element of scene.elementsById.values()) {
    if (!isNode(element as SceneElement)) continue;
    const node = element as SceneNode;
    maxX = seen ? Math.max(maxX, node.x + node.width) : node.x + node.width;
    minY = seen ? Math.min(minY, node.y) : node.y;
    seen = true;
  }
  for (let k = 0; k < 20; k += 1) {
    const point = { x: maxX + 160 + k * 40, y: minY + 40 + k * 20 };
    if (lands(point)) return point;
  }
  return undefined;
}

// --- fixture -----------------------------------------------------------------

interface Loaded {
  moddle: any;
  reader: any;
  definitions: any;
  canvas: Canvas;
  warnings: string[];
}

async function load(filename: string): Promise<Loaded> {
  const warnings: string[] = [];
  const { canvas, definitions, moddle } = await loadCanvas(exampleXml(filename), {
    onWarning: (message: string) => warnings.push(message),
  });
  return { moddle, reader: freshModdle(), definitions, canvas, warnings };
}

async function toXML(loaded: Loaded): Promise<string> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions, { format: true });
  return xml as string;
}

/** Serialize the live tree, re-parse it, and reduce that to a {@link Structure}. */
async function snapshot(loaded: Loaded): Promise<{ xml: string; structure: Structure }> {
  const xml = await toXML(loaded);
  const { rootElement } = await loaded.reader.fromXML(xml);
  return { xml, structure: structureOf(rootElement) };
}

const files = exampleNames;

test('canvas round-trip: all 18 studyflow examples are present', () => {
  expect(files.length).toBe(18);
});

// --- (a) no-op round trip ----------------------------------------------------

for (const filename of files) {
  test(`${filename}: no-op round trip is structurally identical`, async () => {
    const moddle = freshModdle();
    const source = exampleXml(filename);
    const { rootElement: original } = await moddle.fromXML(source);
    const before = structureOf(original);

    if (before.shapes.size === 0 && before.edges.size === 0) {
      console.log(`SKIP ${filename}: no DiagramInterchange present`);
      test.skip(true, `${filename}: no DiagramInterchange`);
      return;
    }

    // A second, independent parse is what the canvas edits — so the comparison is
    // "document as authored" vs "document after the canvas has been through it".
    const loaded = await load(filename);
    expect(loaded.warnings, `${filename}: imports without warnings`).toEqual([]);

    const after = (await snapshot(loaded)).structure;
    const delta = deltaOf(before, after);

    expect(delta.planes.after, `${filename}: same planes`).toEqual(delta.planes.before);
    expectTable(`${filename}: business objects unchanged by a no-op`, delta.bo, {});
    expectTable(`${filename}: BPMNShape bounds unchanged by a no-op`, delta.shapes, {});
    expectTable(`${filename}: BPMNEdge waypoints unchanged by a no-op`, delta.edges, {});
  });
}

// --- (b) edit round trip -----------------------------------------------------

for (const filename of files) {
  test(`${filename}: edit round trip writes exactly the intended deltas`, async () => {
    const loaded = await load(filename);
    const canvas = loaded.canvas;
    const writeback = canvas.getWriteback();
    expect(writeback, `${filename}: has a writeback`).toBeTruthy();

    const targets = leafNodes(canvas);
    if (targets.length === 0) {
      console.log(`SKIP ${filename}: no visible leaf shape to edit`);
      test.skip(true, `${filename}: nothing editable`);
      return;
    }

    // What this example actually exercised, logged at the end so the corpus run
    // reads as a coverage report rather than 18 opaque ticks.
    const steps: string[] = [];
    let state = await snapshot(loaded);

    // --- 1. MOVE (P3) -------------------------------------------------------
    {
      const node = targets[0];
      const dx = 37;
      const dy = 23;
      const expectedBounds = { x: node.x + dx, y: node.y + dy, width: node.width, height: node.height };
      const followed = dockedEdges(node);
      const shapeKeys = hasPlacedLabel(node) ? ['bounds', 'label'] : ['bounds'];

      writeback!.setNodeBounds(node, { x: expectedBounds.x, y: expectedBounds.y });

      const next = await snapshot(loaded);
      const delta = deltaOf(state.structure, next.structure);
      expectTable(`${filename}: move touches no business object`, delta.bo, {});
      expectTable(`${filename}: move writes only the moved shape's bounds`, delta.shapes, {
        changed: { [node.id]: shapeKeys },
      });
      expectTable(`${filename}: move drags only the docked waypoints`, delta.edges, {
        changed: Object.fromEntries(followed.map((edge) => [edge.id, ['waypoints']])),
      });
      expect(
        JSON.parse(next.structure.shapes.get(node.id)!.get('bounds')!),
        `${filename}: moved shape lands at its new dc:Bounds`,
      ).toEqual(expectedBounds);
      steps.push(`move ${node.id}(+${dx},+${dy}) → ${followed.length} edge(s) docked`);
      state = next;
    }

    // --- 2. RENAME (P3) -----------------------------------------------------
    {
      const node = targets[Math.min(1, targets.length - 1)];
      const name = `roundtrip ${node.id}`;
      expect(writeback!.setName(node, name), `${filename}: rename writes`).toBe(true);

      const next = await snapshot(loaded);
      const delta = deltaOf(state.structure, next.structure);
      expectTable(`${filename}: rename writes only that name`, delta.bo, {
        changed: { [node.id]: ['attrs.name'] },
      });
      expectTable(`${filename}: rename touches no shape`, delta.shapes, {});
      expectTable(`${filename}: rename touches no edge`, delta.edges, {});
      expect(JSON.parse(next.structure.bo.get(node.id)!.get('attrs.name')!)).toBe(name);
      steps.push(`rename ${node.id}`);
      state = next;
    }

    // --- 3. CREATE + CONNECT (P4/P5) ---------------------------------------
    {
      const anchor = targets[0];
      const host = anchor.parent;
      const point = freeDropPoint(canvas, host);
      if (!point) {
        console.log(`SKIP ${filename}: create — no free room inside ${host?.id ?? 'the root plane'}`);
      } else {
        // A choreography contains choreography activities, not tasks — ask the
        // rules which of the two this container will take rather than assuming.
        let created: SceneNode | undefined;
        for (const type of ['bpmn:Task', 'bpmn:ChoreographyTask']) {
          created = canvas.createElement({ type, ...NEW_SHAPE }, point);
          if (created) break;
        }
        if (!created) {
          console.log(`SKIP ${filename}: create — rules refuse a shape in ${host?.id ?? 'the root plane'}`);
        } else {
          const lane = laneOf(host);
          // The rules decide what a pair connects *as*. Prefer a plain sequence
          // flow (it exercises the `outgoing`/`incoming` reciprocal writeback);
          // fall back to whatever the rules do allow — a data object leaf, for
          // instance, only ever yields a data association.
          const allowed = targets
            .filter((candidate) => candidate !== created)
            .map((candidate) => ({ candidate, spec: canvas.getRules().canConnect(candidate, created) }))
            .filter((entry): entry is { candidate: SceneNode; spec: { type: string } } => !!entry.spec);
          const chosen =
            allowed.find((entry) => entry.spec.type === 'bpmn:SequenceFlow') ?? allowed[0];
          const source = chosen?.candidate;
          const edge = source ? canvas.connectElements(source, created) : undefined;
          if (source && !edge) {
            console.log(`SKIP ${filename}: connect — rules named a type but the connect refused`);
          } else if (!source) {
            console.log(`SKIP ${filename}: connect — no leaf the rules will connect to a new task`);
          }

          const next = await snapshot(loaded);
          const delta = deltaOf(state.structure, next.structure);
          const changedBo: Record<string, string[]> = {};
          // A sequence flow is filed alongside its ends and pushed onto their
          // `outgoing`/`incoming`; a data association is *contained* by the
          // activity and names its data end by reference, so it changes no
          // pre-existing row at all.
          const isSequenceFlow = edge?.type === 'bpmn:SequenceFlow';
          if (edge && source && isSequenceFlow) changedBo[source.id] = ['refs.outgoing'];
          if (lane) changedBo[lane.id] = ['refs.flowNodeRef'];

          expectTable(`${filename}: create files exactly the new business objects`, delta.bo, {
            added: [created.id, ...(edge ? [edge.id] : [])],
            changed: changedBo,
          });
          expectTable(`${filename}: create adds exactly one BPMNShape`, delta.shapes, {
            added: [created.id],
          });
          expectTable(`${filename}: connect adds exactly one BPMNEdge`, delta.edges, {
            added: edge ? [edge.id] : [],
          });
          expect(
            JSON.parse(next.structure.shapes.get(created.id)!.get('bounds')!),
            `${filename}: the new shape is centred on the drop point`,
          ).toEqual({
            x: point.x - NEW_SHAPE.width / 2,
            y: point.y - NEW_SHAPE.height / 2,
            ...NEW_SHAPE,
          });
          if (edge && source) {
            const row = next.structure.bo.get(edge.id)!;
            if (isSequenceFlow) {
              expect(JSON.parse(row.get('refs.sourceRef')!)).toBe(source.id);
              expect(JSON.parse(row.get('refs.targetRef')!)).toBe(created.id);
            } else {
              // A data association lives inside the activity and names the data
              // shape through a `sourceRef` *list* (`model/dataAssociation.ts`).
              expect(JSON.parse(row.get('parent')!), `${filename}: association filed on the activity`)
                .toBe(created.id);
              expect(JSON.parse(row.get('refs.sourceRef')!)).toContain(source.id);
            }
            expect(
              (JSON.parse(next.structure.edges.get(edge.id)!.get('waypoints')!) as Point[]).length,
              `${filename}: the new BPMNEdge carries routed waypoints`,
            ).toBeGreaterThanOrEqual(2);
          }
          steps.push(
            `create ${created.type} in ${host?.id ?? 'root plane'}` +
              (edge && source ? ` + connect ${source.id} → ${edge.type}` : ' (no connection)') +
              (lane ? ` [lane ${lane.id}]` : ''),
          );
          state = next;

          // --- 3b. DATA ASSOCIATION (P5 (d)) --------------------------------
          // Only the examples that ship a data object/store can offer this one.
          const dataShape = targets.find((candidate) => DATA_TYPES.has(candidate.type));
          if (!dataShape) {
            console.log(`SKIP ${filename}: data association — no data object/store in this example`);
          } else {
            const association = canvas.createDataAssociation(dataShape, created);
            if (!association) {
              console.log(`SKIP ${filename}: data association — rules refuse ${dataShape.id} → the new task`);
            } else {
              const afterData = await snapshot(loaded);
              const dataDelta = deltaOf(state.structure, afterData.structure);
              // The association is *contained* by the activity and names the data
              // shape by reference, so it adds one row and changes none: no
              // pre-existing element gains or loses a field.
              expectTable(`${filename}: the data association is the only new object`, dataDelta.bo, {
                added: [association.id],
              });
              expectTable(`${filename}: the data association adds no shape`, dataDelta.shapes, {});
              expectTable(`${filename}: the data association adds one BPMNEdge`, dataDelta.edges, {
                added: [association.id],
              });
              const row = afterData.structure.bo.get(association.id)!;
              expect(JSON.parse(row.get('type')!)).toBe('bpmn:DataInputAssociation');
              expect(JSON.parse(row.get('parent')!), `${filename}: filed on the activity`).toBe(created.id);
              expect(JSON.parse(row.get('slot')!)).toBe('dataInputAssociations');
              expect(JSON.parse(row.get('refs.sourceRef')!)).toContain(dataShape.id);
              steps.push(`data association ${dataShape.id} → ${created.id}`);
              state = afterData;
            }
          }
        }
      }
    }

    // --- 4. COLOUR (P5) -----------------------------------------------------
    {
      const node = targets[Math.min(2, targets.length - 1)];
      const colors = { fill: '#bbdefb', stroke: '#1e88e5' };
      expect(canvas.setColor(node, colors).length, `${filename}: colour writes`).toBe(1);

      const next = await snapshot(loaded);
      const delta = deltaOf(state.structure, next.structure);
      expectTable(`${filename}: colour touches no business object`, delta.bo, {});
      expectTable(`${filename}: colour touches no edge`, delta.edges, {});
      expect(delta.shapes.added, `${filename}: colour adds no shape`).toEqual([]);
      expect(delta.shapes.removed, `${filename}: colour removes no shape`).toEqual([]);
      expect(
        [...delta.shapes.changed.keys()],
        `${filename}: colour repaints exactly one shape`,
      ).toEqual([node.id]);
      const keys = delta.shapes.changed.get(node.id)!;
      expect(keys.length, `${filename}: all four bpmn.io colour attributes are written`).toBe(4);
      for (const key of keys) {
        expect(key, `${filename}: ${key} is a colour attribute`).toMatch(
          /(fill|stroke|background-color|border-color)$/,
        );
      }

      // Read it back off the re-parsed DI the way the renderer would.
      const reparsed = await loaded.reader.fromXML(next.xml);
      const di = [...(reparsed.rootElement.diagrams ?? [])]
        .flatMap((diagram: any) => diagram.plane?.planeElement ?? [])
        .find((pe: any) => pe.bpmnElement?.id === node.id);
      expect(readColorsOf(di), `${filename}: the colour reloads`).toEqual(colors);
      steps.push(`colour ${node.id}`);
      state = next;
    }

    // --- 5. DELETE (P5) -----------------------------------------------------
    {
      const candidates = targets.filter(
        (node) => !DATA_TYPES.has(node.type) && canvas.getScene()!.elementsById.get(node.id) === node,
      );
      // Prefer an activity that carries boundary events: deleting it must take
      // them (and their flows) with it, which is the widest closure the corpus
      // offers. Otherwise any leaf will do.
      const node =
        candidates.find((candidate) => boundaryEventsOf(canvas, candidate).length > 0) ??
        candidates[candidates.length - 1];
      if (!node) {
        console.log(`SKIP ${filename}: delete — no candidate leaf`);
      } else {
        const closure = deletionClosure(canvas, node);
        const removedNodes = new Set(closure.nodes);
        const closureIds = [...closure.nodes, ...closure.edges].map((element) => element.id);
        // A removed element takes its own ided sub-tree with it — an event
        // definition, an `ioSpecification` slot — none of which the scene graph
        // models, so they are read off the pre-delete structure by containment.
        const removedIds = [...new Set([...closureIds, ...descendantRows(state.structure, closureIds)])];

        // Survivors whose reference lists the delete must prune, computed here.
        const changedBo: Record<string, string[]> = {};
        for (const edge of closure.edges) {
          for (const [end, key] of [
            [edge.source, 'refs.outgoing'],
            [edge.target, 'refs.incoming'],
          ] as const) {
            if (!end || removedNodes.has(end)) continue;
            (changedBo[end.id] ??= []).push(key);
            const bo = end.businessObject as Record<string, any>;
            if (bo.default === edge.businessObject) changedBo[end.id].push('refs.default');
          }
        }
        for (const element of canvas.getScene()!.elementsById.values()) {
          const bo = (element as SceneElement).businessObject as Record<string, any> | undefined;
          if (!bo || bo.$type !== 'bpmn:Lane') continue;
          const refs = Array.isArray(bo.flowNodeRef) ? bo.flowNodeRef : [];
          if (refs.some((ref: any) => [...removedNodes].some((n) => n.businessObject === ref))) {
            (changedBo[bo.id] ??= []).push('refs.flowNodeRef');
          }
        }

        const removed = canvas.deleteElements([node]);
        expect(
          removed.map((element) => element.id).sort(),
          `${filename}: delete removes exactly its closure`,
        ).toEqual([...closureIds].sort());

        const next = await snapshot(loaded);
        const delta = deltaOf(state.structure, next.structure);
        expectTable(`${filename}: delete unfiles exactly the closure`, delta.bo, {
          removed: removedIds,
          changed: Object.fromEntries(
            Object.entries(changedBo).map(([id, keys]) => [id, [...new Set(keys)]]),
          ),
        });
        expectTable(`${filename}: delete drops exactly those BPMNShapes`, delta.shapes, {
          removed: closure.nodes.filter((n) => n.di).map((n) => n.id),
        });
        expectTable(`${filename}: delete drops exactly those BPMNEdges`, delta.edges, {
          removed: closure.edges.filter((e) => e.di).map((e) => e.id),
        });

        // Nothing anywhere still names a removed element — not as an id, not as a
        // `bpmnElement`, not as any reference attribute, not as a `<bpmn:incoming>`
        // / `<bpmn:flowNodeRef>` element body. (Matching the bare id would trip
        // over an unrelated `name="Start"`, so only identifying positions count.)
        for (const id of removedIds) {
          const quoted = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          expect(
            new RegExp(`(?:id|Ref|Refs|bpmnElement|default|Shape)="${quoted}"`).test(next.xml),
            `${filename}: no reference to "${id}" left in the XML`,
          ).toBe(false);
          expect(
            new RegExp(`>\\s*${quoted}\\s*</\\w+:(?:incoming|outgoing|flowNodeRef)>`).test(next.xml),
            `${filename}: no <…>${id}</…> reference left in the XML`,
          ).toBe(false);
        }
        steps.push(
          `delete ${node.id} → ${closure.nodes.length} node(s) + ${closure.edges.length} edge(s)` +
            (removedIds.length > closureIds.length
              ? ` + ${removedIds.length - closureIds.length} nested object(s)`
              : ''),
        );
        state = next;
      }
    }

    // --- the edited document is itself round-trip stable ---------------------
    // Save → load → save again: the edited document must be a fixed point, so no
    // edit above left something that only survives one serialization.
    const { rootElement: reloaded } = await loaded.reader.fromXML(state.xml);
    const { xml: again } = await loaded.reader.toXML(reloaded, { format: true });
    const { rootElement: twice } = await loaded.reader.fromXML(again as string);
    const delta = deltaOf(state.structure, structureOf(twice));
    expectTable(`${filename}: reload keeps every business object`, delta.bo, {});
    expectTable(`${filename}: reload keeps every BPMNShape`, delta.shapes, {});
    expectTable(`${filename}: reload keeps every BPMNEdge`, delta.edges, {});

    console.log(`COVER ${filename}: ${steps.join(' | ')}`);
  });
}
