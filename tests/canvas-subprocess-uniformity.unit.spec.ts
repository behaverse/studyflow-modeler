import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import {
  COLLAPSED_SUBPROCESS_SIZE,
  EXPANDABLE_TYPES,
  isExpandable,
} from '@canvas/model/expand.ts';
import type { Point, SceneEdge, SceneElement, SceneNode } from '@canvas/model/scene.ts';
import { isOrthogonal } from '@canvas/routing/orthogonal.ts';
import { containsPoint } from '@canvas/routing/crop.ts';
import { isDrillable, isVirtualPlane, virtualPlaneOf } from '@canvas/view/plane.ts';

import { exampleXml } from './utils';
import { freshModdle, installDocument, jsdomWindow, loadCanvas, type Loaded } from './canvasHarness';

/**
 * Sub-process behaviour UNIFORMITY (report of 2026-08-27, `sklearn_pipeline`).
 *
 * The report was three defects with one root: the editor treated a sub-process
 * differently depending on how the DOCUMENT happened to store its contents.
 *
 * - a container whose children sat in a nested `bpmndi:BPMNDiagram` got a ↘ badge
 *   and drilled on double click; one whose children sat in the parent plane got no
 *   badge and toggled on double click instead;
 * - an expanded container drew its child SHAPES but not the flows between them;
 * - toggling changed the outline and left every incident edge docked to the old one.
 *
 * So this spec is a MATRIX, not a list: every expandable subclass × both storage
 * kinds, asserting the same contract for each cell. A regression that reintroduces
 * the split fails half the matrix rather than one incidental case.
 *
 * `bpmn:SubChoreography` and `bpmn:CallChoreography` appear in no shipped example, so
 * the fixture is hand-built for every type — which also lets both storage kinds be
 * expressed for the same diagram, which no shipped example does.
 */

installDocument();
const win = jsdomWindow();

/** How a document files a container's contents — the axis the defects split on. */
type Storage = 'parent-plane' | 'nested-plane';
const STORAGES: readonly Storage[] = ['parent-plane', 'nested-plane'];

/** The XML element name moddle serializes a type as (`bpmn:SubProcess` → `subProcess`). */
function elementName(type: string): string {
  const local = type.slice(type.indexOf(':') + 1);
  return `bpmn:${local[0].toLowerCase()}${local.slice(1)}`;
}

/**
 * `bpmn:CallChoreography` is a `ChoreographyActivity` and NOT a flow-element
 * container: the schema gives it a `calledChoreographyRef`, not `flowElements`. It is
 * still expandable — its `BPMNShape.isExpanded` decides whether the called
 * choreography is drawn inline — so it belongs in the matrix, with an empty interior.
 */
function holdsFlowElements(type: string): boolean {
  return type !== 'bpmn:CallChoreography';
}

/**
 * Whether the RULES let a shape be dropped into this container
 * (`rules/rules.ts isFlowContainer`, which covers the `bpmn:SubProcess` family).
 * A choreography sub-container is a flow-element container in the BPMN schema but
 * not in the rule table, so authoring inside one is refused today — a separate gap
 * from the affordance split this spec is about, and deliberately not papered over
 * here.
 */
function acceptsDrops(type: string): boolean {
  return !type.endsWith('Choreography');
}

/**
 * One diagram per matrix cell: `before → C → after`, where `C` is the container under
 * test and (where the schema allows it) holds `kid_a → kid_b`.
 *
 * `parent-plane` draws `C` expanded with its children's DI in the ROOT plane — the
 * shape `sklearn_pipeline`'s `prepare_data` has. `nested-plane` draws it collapsed
 * with the children's DI in a second `BPMNDiagram`, in that plane's own coordinate
 * space — the shape `select_model` has. The business objects are identical either
 * way, which is the point: only the DI moves.
 */
function fixture(type: string, storage: Storage): string {
  const tag = elementName(type);
  const kids = holdsFlowElements(type)
    ? `
      <bpmn:task id="kid_a" name="Kid A" />
      <bpmn:task id="kid_b" name="Kid B" />
      <bpmn:sequenceFlow id="kid_flow" sourceRef="kid_a" targetRef="kid_b" />`
    : '';
  const inline = storage === 'parent-plane';
  const frame = inline
    ? '<dc:Bounds x="300" y="140" width="300" height="200" />'
    : '<dc:Bounds x="300" y="200" width="100" height="80" />';
  const outFrom = inline ? 600 : 400;

  const kidPlaneElements = !kids
    ? ''
    : inline
      ? `
      <bpmndi:BPMNShape id="kid_a_di" bpmnElement="kid_a">
        <dc:Bounds x="340" y="255" width="80" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="kid_b_di" bpmnElement="kid_b">
        <dc:Bounds x="470" y="255" width="80" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="kid_flow_di" bpmnElement="kid_flow">
        <di:waypoint x="420" y="285" />
        <di:waypoint x="470" y="285" />
      </bpmndi:BPMNEdge>`
      : '';
  const nestedDiagram = !kids || inline
    ? ''
    : `
  <bpmndi:BPMNDiagram id="Diagram_Nested">
    <bpmndi:BPMNPlane id="Plane_Nested" bpmnElement="C">
      <bpmndi:BPMNShape id="kid_a_di" bpmnElement="kid_a">
        <dc:Bounds x="50" y="50" width="80" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="kid_b_di" bpmnElement="kid_b">
        <dc:Bounds x="180" y="50" width="80" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="kid_flow_di" bpmnElement="kid_flow">
        <di:waypoint x="130" y="80" />
        <di:waypoint x="180" y="80" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_U" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P_U" isExecutable="false">
    <bpmn:task id="before" name="Before" />
    <bpmn:task id="after" name="After" />
    <${tag} id="C" name="Container">${kids}
    </${tag}>
    <bpmn:sequenceFlow id="in_flow" sourceRef="before" targetRef="C" />
    <bpmn:sequenceFlow id="out_flow" sourceRef="C" targetRef="after" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Root">
    <bpmndi:BPMNPlane id="Plane_Root" bpmnElement="P_U">
      <bpmndi:BPMNShape id="before_di" bpmnElement="before">
        <dc:Bounds x="100" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="C_di" bpmnElement="C" isExpanded="${inline}">
        ${frame}
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="after_di" bpmnElement="after">
        <dc:Bounds x="700" y="200" width="100" height="80" />
      </bpmndi:BPMNShape>${kidPlaneElements}
      <bpmndi:BPMNEdge id="in_flow_di" bpmnElement="in_flow">
        <di:waypoint x="200" y="240" />
        <di:waypoint x="300" y="240" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="out_flow_di" bpmnElement="out_flow">
        <di:waypoint x="${outFrom}" y="240" />
        <di:waypoint x="700" y="240" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>${nestedDiagram}
</bpmn:definitions>`;
}

// --- readers -------------------------------------------------------------------

function node(canvas: Canvas, id: string): SceneNode {
  const element = canvas.getScene()!.elementsById.get(id);
  if (!element || element.kind !== 'node') throw new Error(`no node '${id}'`);
  return element;
}

function edge(canvas: Canvas, id: string): SceneEdge {
  const element = canvas.getScene()!.elementsById.get(id);
  if (!element || element.kind !== 'edge') throw new Error(`no edge '${id}'`);
  return element;
}

function centre(n: SceneNode): Point {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

function fireMouse(canvas: Canvas, type: string, at: Point): void {
  const screen = canvas.getViewport().toScreen(at);
  canvas.getSvg().dispatchEvent(new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: screen.x,
    clientY: screen.y,
    button: 0,
  }) as unknown as Event);
}

async function toXML(loaded: Loaded): Promise<string> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  return xml;
}

/** Whether `p` sits on the outline of `n` — the dock a re-route must land on. */
function onOutline(n: SceneNode, p: Point): boolean {
  const slack = 0.5;
  const onX = Math.abs(p.x - n.x) <= slack || Math.abs(p.x - (n.x + n.width)) <= slack;
  const onY = Math.abs(p.y - n.y) <= slack || Math.abs(p.y - (n.y + n.height)) <= slack;
  const withinX = p.x >= n.x - slack && p.x <= n.x + n.width + slack;
  const withinY = p.y >= n.y - slack && p.y <= n.y + n.height + slack;
  return (onX && withinY) || (onY && withinX);
}

/** The drill-down badges currently painted, by the element they belong to. */
function badges(canvas: Canvas): string[] {
  canvas.getPlaneCursor().refresh();
  return [...canvas.getHostLayer('drilldown', 900).querySelectorAll('.sf-drilldown')]
    .map((g) => g.getAttribute('data-drilldown') ?? '');
}

// --- the vocabulary is closed and wired end to end -----------------------------

test('EXPANDABLE_TYPES is exactly the five container subclasses, and every one is wired', async () => {
  // Pinned so a sixth type cannot be added to the set without someone confirming it
  // reaches the badge, the toggle and the rules in the same commit.
  expect([...EXPANDABLE_TYPES].sort()).toEqual([
    'bpmn:AdHocSubProcess',
    'bpmn:CallChoreography',
    'bpmn:SubChoreography',
    'bpmn:SubProcess',
    'bpmn:Transaction',
  ]);

  for (const type of EXPANDABLE_TYPES) {
    const { canvas } = await loadCanvas(fixture(type, 'parent-plane'));
    const container = node(canvas, 'C');
    expect(container.type, type).toBe(type);
    expect(isExpandable(type), type).toBe(true);
    expect(canvas.canExpand(container), type).toBe(true);
    expect(isDrillable(canvas.getScene()!, container), type).toBe(true);
  }
});

// --- the matrix ----------------------------------------------------------------

for (const type of [...EXPANDABLE_TYPES].sort()) {
  for (const storage of STORAGES) {
    const label = `${type} (${storage})`;

    test(`${label}: wears a drill-down badge and enters, writing nothing`, async () => {
      const loaded = await loadCanvas(fixture(type, storage));
      const { canvas } = loaded;
      const scene = canvas.getScene()!;
      const container = node(canvas, 'C');
      const before = await toXML(loaded);
      const revision = scene.revision;
      const diagrams = loaded.definitions.diagrams.length;

      // Defect 1: the badge is on the container whatever the storage and whatever
      // state it is drawn in — collapsed (`nested-plane`) or expanded (`parent-plane`).
      expect(badges(canvas)).toEqual(['C']);

      expect(canvas.getPlaneCursor().enterPlane(container)).toBe(true);
      const path = canvas.getPlaneCursor().planePath();
      expect(path).toHaveLength(2);
      expect(path[0]).toBe(scene.rootPlane);
      expect(canvas.getRoot().id).toBe('C');
      // Outside the scope is neither drawn nor clickable, either way in.
      expect(canvas.getGraphics('before')?.getAttribute('display')).toBe('none');
      expect(canvas.elementAt(centre(node(canvas, 'before')))).toBeUndefined();

      // Navigation is VIEW-ONLY, and a synthesized scope is not a document object:
      // no extra plane, no extra diagram, no revision, and the same bytes out.
      expect(loaded.definitions.diagrams).toHaveLength(diagrams);
      expect(scene.planes).toHaveLength(storage === 'nested-plane' && holdsFlowElements(type) ? 2 : 1);
      expect(scene.revision).toBe(revision);
      expect(await toXML(loaded)).toBe(before);

      expect(canvas.getPlaneCursor().goToPlane(scene.rootPlane)).toBe(true);
      expect(canvas.getGraphics('before')?.getAttribute('display')).not.toBe('none');
      expect(await toXML(loaded)).toBe(before);
    });

    test(`${label}: double click toggles in place, both ways, without navigating`, async () => {
      const { canvas } = await loadCanvas(fixture(type, storage));
      const scene = canvas.getScene()!;
      const container = node(canvas, 'C');
      const started = container.isExpanded;
      const root = scene.rootPlane;

      // The body, not the caption: a click on an expanded frame's own name opens the
      // rename editor instead (asserted separately below).
      const body = { x: container.x + 12, y: container.y + container.height - 12 };
      fireMouse(canvas, 'dblclick', body);

      expect(container.isExpanded).toBe(!started);
      expect(container.di?.isExpanded).toBe(!started);
      // Defect 1 again, from the other side: the double click never navigates now.
      expect(canvas.getPlaneCursor().current()).toBe(root);
      expect(canvas.getLabelEditing().isActive()).toBe(false);

      fireMouse(canvas, 'dblclick', { x: container.x + 12, y: container.y + container.height - 12 });
      expect(container.isExpanded).toBe(started);
      expect(canvas.getPlaneCursor().current()).toBe(root);
    });

    test(`${label}: a toggle re-docks its incident edges to the new outline, in one step`, async () => {
      const { canvas } = await loadCanvas(fixture(type, storage));
      const scene = canvas.getScene()!;
      const container = node(canvas, 'C');
      const revision = scene.revision;

      // Before: the document docks both flows to the outline it shipped.
      expect(onOutline(container, edge(canvas, 'in_flow').waypoints.at(-1)!)).toBe(true);

      expect(canvas.toggleExpanded(container)).toBe(true);

      // Defect 3: the outline changed, so the docks moved with it — and the routes
      // came back Manhattan, cropped to the frame rather than buried inside it.
      for (const id of ['in_flow', 'out_flow']) {
        const flow = edge(canvas, id);
        const dock = id === 'in_flow' ? flow.waypoints.at(-1)! : flow.waypoints[0];
        expect(onOutline(container, dock), `${id} docks to the new outline`).toBe(true);
        expect(containsPoint(container, flow.waypoints[id === 'in_flow' ? 0 : flow.waypoints.length - 1]))
          .toBe(false);
        expect(isOrthogonal(flow.waypoints), `${id} is orthogonal`).toBe(true);
      }
      // ONE revision bump for the flag, the bounds AND the re-routes: one undo step.
      expect(scene.revision).toBe(revision + 1);

      // …and back: the toggle is its own inverse, down to the waypoints.
      expect(canvas.toggleExpanded(container)).toBe(true);
      for (const id of ['in_flow', 'out_flow']) {
        expect(onOutline(container, edge(canvas, id).waypoints[id === 'in_flow' ? 1 : 0])).toBe(true);
      }
    });

    if (holdsFlowElements(type)) {
      test(`${label}: a toggle leaves the interior layout alone`, async () => {
        const { canvas } = await loadCanvas(fixture(type, storage));
        const container = node(canvas, 'C');
        const a = node(canvas, 'kid_a');
        const b = node(canvas, 'kid_b');
        const flow = edge(canvas, 'kid_flow');

        const offset = { x: b.x - a.x, y: b.y - a.y };
        const shape = flow.waypoints.map((p) => ({ x: p.x - a.x, y: p.y - a.y }));

        canvas.toggleExpanded(container);

        // Interior geometry is either untouched (`parent-plane`) or moved by ONE
        // translation into the frame (`nested-plane`) — never re-routed. A
        // `edgesAffectedBy` creeping into the toggle path fails right here.
        expect({ x: b.x - a.x, y: b.y - a.y }).toEqual(offset);
        expect(flow.waypoints.map((p) => ({ x: p.x - a.x, y: p.y - a.y }))).toEqual(shape);
      });

      test(`${label}: an expanded container draws its interior EDGES above its own frame`, async () => {
        const { canvas } = await loadCanvas(fixture(type, storage));
        const container = node(canvas, 'C');
        if (container.isExpanded === false) canvas.setExpanded(container, true);

        // Defect 2. The interior flow was never `display:none` — it was painted over,
        // because connections had a layer of their own BELOW every shape and the
        // container's frame is opaque. So the assertion that matters is Z-ORDER, not
        // visibility: `display` is exactly what missed this bug.
        for (const id of ['kid_a', 'kid_b', 'kid_flow']) {
          expect(canvas.getGraphics(id)?.getAttribute('display'), id).not.toBe('none');
        }
        const layer = canvas.getSvg().querySelector('[data-layer="elements"]')!;
        const order = [...layer.children].map((g) => g.getAttribute('data-element-id'));
        expect(order.indexOf('kid_flow')).toBeGreaterThan(order.indexOf('C'));
        expect(order.indexOf('kid_a')).toBeGreaterThan(order.indexOf('C'));
        // …and a root-level flow still passes UNDER the shape it points at, which a
        // naive "edges on top" would have broken for every diagram.
        expect(order.indexOf('in_flow')).toBeLessThan(order.indexOf('before'));

        // Rendering and hit-testing agree: what is on top is what a click finds.
        const mid = edge(canvas, 'kid_flow').waypoints;
        const at = { x: (mid[0].x + mid[1].x) / 2, y: (mid[0].y + mid[1].y) / 2 };
        expect(canvas.hitTest(at)?.id).toBe('kid_flow');
      });

      if (acceptsDrops(type)) {
      test(`${label}: a shape created inside the scope is filed in the container`, async () => {
        const loaded = await loadCanvas(fixture(type, storage));
        const { canvas } = loaded;
        const container = node(canvas, 'C');
        canvas.getPlaneCursor().enterPlane(container);

        const kid = node(canvas, 'kid_a');
        // A choreography container takes choreography tasks, an ordinary one takes
        // ordinary tasks — the rules decide, and this spec is about WHERE a drop is
        // filed, not about what may be dropped.
        const dropped = type.endsWith('Choreography') ? 'bpmn:ChoreographyTask' : 'bpmn:Task';
        const made = canvas.createElement({ type: dropped }, { x: kid.x + 300, y: kid.y + 200 });
        expect(made, 'the drop was allowed').toBeTruthy();

        // Whatever the storage, the business object joins the CONTAINER's
        // `flowElements` — the half a synthesized scope answers through
        // `Canvas.setActiveContainer` rather than through the plane.
        const { xml } = await loaded.moddle.toXML(loaded.definitions);
        const { rootElement: reloaded } = await freshModdle().fromXML(xml);
        const contents = findById(reloaded, 'C').flowElements.map((el: any) => el.id);
        expect(contents).toContain(made!.id);

        // …and the DI joins the plane the container's OWN shape is filed in: the root
        // plane for in-parent storage, the nested one for a container that has a plane.
        const plane = storage === 'nested-plane'
          ? reloaded.diagrams[1].plane
          : reloaded.diagrams[0].plane;
        expect(plane.planeElement.some((pe: any) => pe.bpmnElement?.id === made!.id)).toBe(true);
      });
      }
    }
  }
}

/** The first moddle object with `id` anywhere in a parsed tree. */
function findById(definitions: any, id: string): any {
  let found: any;
  const visit = (value: any, seen: Set<any>): void => {
    if (found || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, seen);
      return;
    }
    if (typeof value.$type !== 'string') return;
    if (value.id === id) {
      found = value;
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('$')) continue;
      visit(child, seen);
    }
  };
  visit(definitions, new Set());
  return found;
}

// --- the synthesized scope is a VIEW object, never a document one ---------------

test('a synthesized scope is not a plane: it never joins `scene.planes` or `definitions.diagrams`', async () => {
  const loaded = await loadCanvas(exampleXml('sklearn_pipeline.studyflow.png'));
  const { canvas } = loaded;
  const scene = canvas.getScene()!;
  const prepare = node(canvas, 'prepare_data');

  const scope = virtualPlaneOf(prepare);
  expect(isVirtualPlane(scope)).toBe(true);
  expect(virtualPlaneOf(prepare)).toBe(scope);
  expect(scene.planes).not.toContain(scope);

  canvas.getPlaneCursor().enterPlane(prepare);
  expect(scene.planes).toHaveLength(3);
  expect(loaded.definitions.diagrams).toHaveLength(3);
  expect(canvas.getPlaneCursor().current()).toBe(scope);
});

// --- rename is still reachable ---------------------------------------------------

test('a double click on an expanded frame\'s own name opens the rename editor', async () => {
  const { canvas } = await loadCanvas(fixture('bpmn:SubProcess', 'parent-plane'));
  const container = node(canvas, 'C');
  expect(container.isExpanded).toBe(true);

  // The caption is drawn centred in the frame (`render/labels.ts drawInternalLabel`),
  // and that is the one spot a double click means "rename" rather than "collapse" —
  // the escape hatch requirement A asks for, beside the context pad's own entry.
  fireMouse(canvas, 'dblclick', centre(container));

  expect(canvas.getLabelEditing().isActive()).toBe(true);
  expect(canvas.getLabelEditing().getValue()).toBe('Container');
  expect(container.isExpanded).toBe(true);

  // …and a double click on the BODY, clear of the caption, still collapses it: the
  // escape hatch is the name, not the whole frame.
  canvas.getLabelEditing().cancel();
  fireMouse(canvas, 'dblclick', { x: container.x + 12, y: container.y + container.height - 12 });
  expect(container.isExpanded).toBe(false);
});

// --- the reported document, end to end -------------------------------------------

test('sklearn_pipeline: both storage kinds offer both affordances, and the round trip stays clean', async () => {
  const loaded = await loadCanvas(exampleXml('sklearn_pipeline.studyflow.png'));
  const { canvas } = loaded;
  const before = await toXML(loaded);

  // The report's own diagram: one in-parent container and two planed ones, all three
  // now offering the same two gestures.
  expect(badges(canvas)).toEqual(['prepare_data', 'select_model', 'evaluate_and_report']);
  for (const id of ['prepare_data', 'select_model', 'evaluate_and_report']) {
    const container = node(canvas, id);
    expect(canvas.getPlaneCursor().enterPlane(container), id).toBe(true);
    expect(canvas.getRoot().id, id).toBe(id);
    canvas.getPlaneCursor().goToPlane(canvas.getScene()!.rootPlane);
  }
  // Navigating every container of the document leaves it byte-identical.
  expect(await toXML(loaded)).toBe(before);

  // …and a toggle of each, there and back, leaves it byte-identical too.
  for (const id of ['prepare_data', 'select_model', 'evaluate_and_report']) {
    const container = node(canvas, id);
    expect(canvas.toggleExpanded(container), id).toBe(true);
    expect(canvas.toggleExpanded(container), id).toBe(true);
  }
  expect(await toXML(loaded)).toBe(before);
});

/** Every element id the scene holds, for the interior-visibility sweep below. */
function interiorOf(canvas: Canvas, id: string): SceneElement[] {
  const out: SceneElement[] = [];
  const visit = (n: SceneNode): void => {
    for (const child of n.children) {
      out.push(child);
      if (child.kind === 'node') visit(child);
    }
  };
  visit(node(canvas, id));
  return out;
}

test('sklearn_pipeline: every element inside the expanded `prepare_data` paints above it', async () => {
  const { canvas } = await loadCanvas(exampleXml('sklearn_pipeline.studyflow.png'));
  const layer = canvas.getSvg().querySelector('[data-layer="elements"]')!;
  const order = [...layer.children].map((g) => g.getAttribute('data-element-id'));
  const container = order.indexOf('prepare_data');
  expect(container).toBeGreaterThanOrEqual(0);

  const interior = interiorOf(canvas, 'prepare_data');
  expect(interior.some((el) => el.kind === 'edge')).toBe(true);
  for (const element of interior) {
    expect(canvas.getGraphics(element.id)?.getAttribute('display'), element.id).not.toBe('none');
    expect(order.indexOf(element.id), `${element.id} paints above prepare_data`)
      .toBeGreaterThan(container);
  }
});

test('a collapsed container still hides its interior, whatever the layer order', async () => {
  const { canvas } = await loadCanvas(exampleXml('sklearn_pipeline.studyflow.png'));
  canvas.setExpanded(node(canvas, 'prepare_data'), false);
  for (const element of interiorOf(canvas, 'prepare_data')) {
    expect(canvas.getGraphics(element.id)?.getAttribute('display'), element.id).toBe('none');
  }
  // Collapsed to the plain activity box, so nothing of the interior is clickable.
  const prepare = node(canvas, 'prepare_data');
  expect([prepare.width, prepare.height])
    .toEqual([COLLAPSED_SUBPROCESS_SIZE.width, COLLAPSED_SUBPROCESS_SIZE.height]);
});
