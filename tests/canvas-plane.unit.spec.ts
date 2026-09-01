import { expect, test } from '@playwright/test';

import { Canvas } from '@canvas/index.ts';
import {
  DRILLDOWN_BADGE_SIZE,
  isDrillable,
  nestedPlaneOf,
  PlaneCursor,
  planeOf,
  planeOwner,
  planePathOf,
} from '@canvas/view/plane.ts';
import type { Plane, Scene, SceneNode } from '@canvas/model/scene.ts';

import { createEditor } from '@canvas/editor.ts';

import { exampleXml } from './utils';

import { freshModdle, installDocument, jsdomWindow, loadCanvas } from './canvasHarness';

/**
 * P6b drill-down — the CURRENT-PLANE view cursor (`packages/canvas/src/view/plane.ts`,
 * `scratchpad/subprocess-drilldown-spec.md`).
 *
 * The fixture is the shipped `sklearn_pipeline`, which is exactly the shape of the
 * problem: `select_model` is a sub-process drawn COLLAPSED (`isExpanded="false"`)
 * that owns its own `bpmndi:BPMNDiagram`, so its children (`build_pipeline`,
 * `cross_validate`, …) live on a plane of their own and are neither drawn nor
 * clickable while the view sits at the document root.
 *
 * The contract under test is two-sided:
 *
 * - **the view moves** — entering the plane shows its contents, hides everything
 *   outside it from rendering AND hit-testing, and reports the trail; going back up
 *   puts the parent plane back exactly as it was;
 * - **the document does not** — navigation calls no `Writeback`, so `toXML` of the
 *   live moddle tree is byte-identical before, during and after a round trip
 *   (plan §5-D5). That assertion is made against `bpmn-moddle`, never the scene.
 */

installDocument();
const win = jsdomWindow();

const EXAMPLE = 'sklearn_pipeline.studyflow.png';

interface Loaded {
  canvas: Canvas;
  scene: Scene;
  definitions: any;
  moddle: any;
  cursor: PlaneCursor;
  layer: SVGElement;
}

async function load(): Promise<Loaded> {
  const { canvas, definitions, moddle } = await loadCanvas(exampleXml(EXAMPLE));
  const scene = canvas.getScene()!;
  // The canvas OWNS its cursor (and the badge layer the cursor paints into): a
  // second one built here would be a second set of badges over the same diagram.
  const cursor = canvas.getPlaneCursor();
  const layer = canvas.getHostLayer('drilldown', 900);
  return { canvas, scene, definitions, moddle, cursor, layer };
}

async function toXML(loaded: Loaded): Promise<string> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  return xml;
}

/** The scene node of `id`, which the fixture guarantees is a node. */
function node(scene: Scene, id: string): SceneNode {
  const element = scene.elementsById.get(id);
  if (!element || element.kind !== 'node') throw new Error(`no node '${id}' in the fixture`);
  return element;
}

/** The plane `select_model` owns. */
function subPlane(loaded: Loaded): Plane {
  const plane = nestedPlaneOf(loaded.scene, node(loaded.scene, 'select_model'));
  if (!plane) throw new Error('the fixture lost `select_model`\'s nested plane');
  return plane;
}

/** Whether the element's graphics are on screen (drawn and not display:none). */
function isDrawn(loaded: Loaded, id: string): boolean {
  const g = loaded.canvas.getGraphics(id);
  return !!g && g.getAttribute('display') !== 'none';
}

/** The centre of a node, in diagram coordinates. */
function centre(scene: Scene, id: string): { x: number; y: number } {
  const n = node(scene, id);
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

test.describe('plane cursor', () => {
  test('the fixture drills: `select_model` is collapsed and owns a plane of its own', async () => {
    const loaded = await load();
    const sub = node(loaded.scene, 'select_model');

    expect(sub.isExpanded).toBe(false);
    expect(isDrillable(loaded.scene, sub)).toBe(true);
    expect(planeOwner(loaded.scene, subPlane(loaded))).toBe(sub);
    // …and so does the INLINE-EXPANDED one, which owns no plane at all. How a
    // document stores a sub-process's contents is not something the user should have
    // to know: `prepare_data` is entered through a synthesized scope over its
    // children (`view/plane.ts virtualPlaneOf`), and gets the same badge for it.
    expect(isDrillable(loaded.scene, node(loaded.scene, 'prepare_data'))).toBe(true);
    // A shape that is not a container still offers nothing.
    expect(isDrillable(loaded.scene, node(loaded.scene, 'is_good_enough'))).toBe(false);
    // The contents of the collapsed phase start out hidden, on their own plane.
    expect(planeOf(loaded.scene, node(loaded.scene, 'cross_validate'))).toBe(subPlane(loaded));
    expect(planeOf(loaded.scene, node(loaded.scene, 'select_model'))).toBe(loaded.scene.rootPlane);
    expect(isDrawn(loaded, 'cross_validate')).toBe(false);
  });

  test('entering a sub-process\'s plane hides every element of the parent plane from hit-testing and rendering', async () => {
    const loaded = await load();
    const insideCentre = centre(loaded.scene, 'cross_validate');

    expect(loaded.cursor.enterPlane(node(loaded.scene, 'select_model'))).toBe(true);

    // The plane's own contents are drawn and clickable…
    expect(isDrawn(loaded, 'cross_validate')).toBe(true);
    expect(isDrawn(loaded, 'build_pipeline')).toBe(true);
    expect(loaded.canvas.elementAt(insideCentre)?.id).toBe('cross_validate');

    // …and everything of the parent plane is neither.
    expect(isDrawn(loaded, 'select_model')).toBe(false);
    expect(isDrawn(loaded, 'prepare_data')).toBe(false);
    expect(loaded.canvas.elementAt(centre(loaded.scene, 'select_model'))).toBeUndefined();
    expect(loaded.canvas.elementAt(centre(loaded.scene, 'prepare_data'))).toBeUndefined();
  });

  test('`planePath` reports root → sub-process, and going back up restores the parent plane', async () => {
    const loaded = await load();
    const root = loaded.scene.rootPlane;

    expect(loaded.cursor.planePath()).toEqual([root]);
    expect(loaded.cursor.isDrilledDown()).toBe(false);

    loaded.cursor.enterPlane(node(loaded.scene, 'select_model'));
    expect(loaded.cursor.planePath()).toEqual([root, subPlane(loaded)]);
    expect(loaded.cursor.current()).toBe(subPlane(loaded));
    expect(loaded.cursor.isDrilledDown()).toBe(true);
    expect(planePathOf(loaded.scene, subPlane(loaded))).toEqual([root, subPlane(loaded)]);

    expect(loaded.cursor.goToPlane(root)).toBe(true);
    expect(loaded.cursor.planePath()).toEqual([root]);
    // The parent plane comes back exactly as it was: the phase visible and clickable,
    // its contents hidden again by the collapse the document declares.
    expect(isDrawn(loaded, 'select_model')).toBe(true);
    expect(isDrawn(loaded, 'cross_validate')).toBe(false);
    expect(loaded.canvas.elementAt(centre(loaded.scene, 'select_model'))?.id).toBe('select_model');
    expect(node(loaded.scene, 'select_model').isExpanded).toBe(false);
  });

  test('navigation writes nothing: `toXML` is byte-identical across a round trip through the sub-plane', async () => {
    const loaded = await load();
    const before = await toXML(loaded);
    const revision = loaded.scene.revision;

    loaded.cursor.enterPlane(node(loaded.scene, 'select_model'));
    const inside = await toXML(loaded);
    loaded.cursor.goToPlane(loaded.scene.rootPlane);
    const after = await toXML(loaded);

    expect(inside).toBe(before);
    expect(after).toBe(before);
    // No mutation counter moved either, so nothing recorded a history step.
    expect(loaded.scene.revision).toBe(revision);
  });

  test('a selected sub-process wears a blue drill-down badge titled `Open <name>`', async () => {
    const loaded = await load();
    loaded.cursor.refresh();

    // Badges are selection-gated: an unselected canvas shows none.
    expect(loaded.layer.querySelectorAll('.sf-drilldown').length).toBe(0);

    // EVERY selected expandable container of the plane on screen, whichever way the
    // document stores its contents and whichever state it is drawn in: the
    // inline-expanded `prepare_data` alongside the two collapsed, planed phases.
    loaded.canvas.getSelection().select(['prepare_data', 'select_model', 'evaluate_and_report']);
    const badges = [...loaded.layer.querySelectorAll('.sf-drilldown')];
    expect(badges.map((g) => g.getAttribute('data-drilldown')))
      .toEqual(['prepare_data', 'select_model', 'evaluate_and_report']);
    const badge = loaded.layer.querySelector('[data-drilldown="select_model"]') as SVGGElement;
    expect(badge.querySelector('title')?.textContent).toBe('Open select_model');
    // The attribute too: `page.getByTitle` matches that one, never the child.
    expect(badge.getAttribute('title')).toBe('Open select_model');

    // Bottom-right of the shape, mostly outside it (`edge-videos/sub/frame_10`).
    const sub = node(loaded.scene, 'select_model');
    expect(badge.getAttribute('transform')).toBe(
      `translate(${sub.x + sub.width - 13}, ${sub.y + sub.height + 6})`,
    );
    const rect = badge.querySelector('rect');
    expect(rect?.getAttribute('width')).toBe(String(DRILLDOWN_BADGE_SIZE));
    expect(rect?.getAttribute('fill')).toBe('hsl(205, 100%, 50%)');

    // Clicking it enters the plane, and the badge goes with the plane it belonged to.
    badge.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    expect(loaded.cursor.current()).toBe(subPlane(loaded));
    expect(loaded.layer.querySelectorAll('.sf-drilldown').length).toBe(0);
  });

  test('double-clicking a collapsed sub-process expands it in place rather than navigating', async () => {
    const loaded = await load();
    const sub = node(loaded.scene, 'select_model');
    const root = loaded.scene.rootPlane;
    const graphics = loaded.canvas.getGraphics('select_model');
    expect(graphics).toBeTruthy();

    const screen = loaded.canvas.getViewport().toScreen(centre(loaded.scene, 'select_model'));
    graphics!.dispatchEvent(new win.MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: screen.x,
      clientY: screen.y,
    }) as unknown as Event);

    // The cursor stayed put — drill-down belongs to the badge now. The plane cursor
    // used to steal this event in the capture phase for a COLLAPSED, PLANED container
    // and let it through for every other one, which is precisely why one sub-process
    // of this fixture navigated and its neighbour expanded.
    expect(loaded.cursor.current()).toBe(root);
    expect(sub.di?.isExpanded).toBe(true);
    expect(sub.isExpanded).toBe(true);
    // …and once selected the badge is there, so the trip in is one click away.
    loaded.canvas.getSelection().select('select_model');
    expect(loaded.layer.querySelector('[data-drilldown="select_model"]')).toBeTruthy();
  });

  test('a container with no plane of its own is entered through a synthesized scope, writing nothing', async () => {
    const loaded = await load();
    const prepare = node(loaded.scene, 'prepare_data');
    const before = await toXML(loaded);
    const revision = loaded.scene.revision;
    const diagrams = loaded.definitions.diagrams.length;

    expect(loaded.cursor.enterPlane(prepare)).toBe(true);

    // The scope is its children — drawn and clickable — and nothing else.
    expect(isDrawn(loaded, 'select_features')).toBe(true);
    expect(isDrawn(loaded, 'Flow_Select_Features_Select_Target')).toBe(true);
    expect(isDrawn(loaded, 'select_model')).toBe(false);
    expect(isDrawn(loaded, 'prepare_data')).toBe(false);
    expect(loaded.canvas.elementAt(centre(loaded.scene, 'select_model'))).toBeUndefined();

    // The trail names the container, and `elements.root()` follows it.
    const path = loaded.cursor.planePath();
    expect(path).toHaveLength(2);
    expect(path[0]).toBe(loaded.scene.rootPlane);
    expect(loaded.canvas.getRoot().id).toBe('prepare_data');

    // Nothing was synthesized INTO the document: no extra plane, no extra diagram,
    // no revision bump — and the serialization is byte-identical, there and back.
    expect(loaded.scene.planes).toHaveLength(3);
    expect(loaded.definitions.diagrams).toHaveLength(diagrams);
    expect(await toXML(loaded)).toBe(before);

    expect(loaded.cursor.goToPlane(loaded.scene.rootPlane)).toBe(true);
    expect(isDrawn(loaded, 'select_model')).toBe(true);
    expect(loaded.scene.revision).toBe(revision);
    expect(await toXML(loaded)).toBe(before);
  });

  test('the facade publishes the trail, the trip, and the plane on screen as its root', async () => {
    const moddle = freshModdle();
    const canvas = new Canvas();
    const port = createEditor(canvas, {
      model: {
        moddle: () => moddle,
        create: (type: string, props?: Record<string, unknown>) => moddle.create(type, props),
        createBusinessObject: (type: string, props?: Record<string, unknown>) => moddle.create(type, props),
        fromXML: (xml: string) => moddle.fromXML(xml),
        toXML: (definitions: any, options?: { format?: boolean }) => moddle.toXML(definitions, options),
        ids: { nextPrefixed: (prefix: string) => `${prefix}1`, assigned: () => undefined },
      } as any,
      // The app's snapshot history, stubbed: this spec is about the plane cursor,
      // and the facade takes a history because the canvas has no undo of its own.
      history: {
        revision: () => 0,
        undo: () => undefined,
        redo: () => undefined,
        canUndo: () => false,
        canRedo: () => false,
        record: () => undefined,
        reset: () => undefined,
      },
    });

    const roots: string[] = [];
    port.events.on('RootSet', (event: any) => roots.push(event?.element?.id));
    await port.importXML(exampleXml(EXAMPLE));

    expect(port.canvas.planePath().map((root: any) => root.id)).toEqual(['sklearn_pipeline']);
    expect(port.elements.root().id).toBe('sklearn_pipeline');

    // The badges go into a host layer above the built-in stack, so an import drops
    // them with everything else and the next paint re-attaches (`Canvas.getHostLayer`).
    // Selection-gated: the badge appears once its container is selected.
    canvas.getSelection().select('select_model');
    const badge = canvas.getSvg()
      .querySelector('[data-layer="drilldown"] [data-drilldown="select_model"]');
    expect(badge).toBeTruthy();

    badge!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    const path = port.canvas.planePath();
    expect(path.map((root: any) => root.id)).toEqual(['sklearn_pipeline', 'select_model']);
    // `elements.root()` follows the view, so the inspector resolves against the plane
    // on screen rather than the document root — and `RootSet` says so.
    expect(port.elements.root().id).toBe('select_model');
    expect(roots[roots.length - 1]).toBe('select_model');

    expect(port.canvas.goToPlane(path[0])).toBe(true);
    expect(port.elements.root().id).toBe('sklearn_pipeline');
    expect(roots[roots.length - 1]).toBe('sklearn_pipeline');
  });

  test('destroying the canvas takes the cursor down with it', async () => {
    const loaded = await load();
    loaded.canvas.getSelection().select('select_model');
    loaded.cursor.refresh();
    expect(loaded.layer.querySelectorAll('.sf-drilldown').length).toBeGreaterThan(0);

    // Nothing used to own this: the cursor was built by whoever assembled the
    // facade and torn down by nobody, so a re-mounted editor left the previous
    // instance's capture-phase `dblclick` listener and its badge group behind.
    loaded.canvas.destroy();

    // The badge group is removed from the host layer — which is the cursor's own
    // teardown, not the layer sweep: `Layers.clear` detaches the LAYER, and this
    // asserts on the `<g>` itself, which the test still holds.
    expect(loaded.layer.querySelector('.sf-drilldowns')).toBeNull();
    // …and it stays gone: a destroyed cursor paints nothing, however it is poked.
    loaded.cursor.refresh();
    expect(loaded.layer.querySelector('.sf-drilldowns')).toBeNull();
  });
});
