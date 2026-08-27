import { expect, test } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
import {
  Canvas,
  PlaneCursor,
  createCanvasEditorPort,
  isDrillable,
  nestedPlaneOf,
  planeOf,
  planeOwner,
  planePathOf,
  setDocument,
  DRILLDOWN_BADGE_SIZE,
} from '@canvas/index.ts';
import type { Plane, Scene, SceneNode } from '@canvas/model/scene.ts';

import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

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

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, unknown> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
setDocument(dom.window.document as unknown as Document);

function freshModdle(): any {
  return new BpmnModdle(structuredClone(packages)) as any;
}

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
  const moddle = freshModdle();
  const { rootElement: definitions } = await moddle.fromXML(exampleXml(EXAMPLE));
  const canvas = new Canvas();
  const scene = canvas.importDefinitions(definitions);
  const layer = dom.window.document.createElementNS(
    'http://www.w3.org/2000/svg',
    'g',
  ) as unknown as SVGElement;
  canvas.getSvg().appendChild(layer);
  const cursor = new PlaneCursor({ canvas, layer: () => layer });
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
    // An inline-expanded sub-process draws its children where they already are, so
    // it offers no drill-down.
    expect(isDrillable(loaded.scene, node(loaded.scene, 'prepare_data'))).toBe(false);
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

  test('a collapsed sub-process wears a blue drill-down badge titled `Open <name>`', async () => {
    const loaded = await load();
    loaded.cursor.refresh();

    // Both collapsed phases of the fixture own a plane, so both offer the trip.
    const badges = [...loaded.layer.querySelectorAll('.sf-drilldown')];
    expect(badges.map((g) => g.getAttribute('data-drilldown')))
      .toEqual(['select_model', 'evaluate_and_report']);
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
    badge.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    expect(loaded.cursor.current()).toBe(subPlane(loaded));
    expect(loaded.layer.querySelectorAll('.sf-drilldown').length).toBe(0);
  });

  test('double-clicking a collapsed sub-process enters its plane instead of expanding it', async () => {
    const loaded = await load();
    const sub = node(loaded.scene, 'select_model');
    const before = await toXML(loaded);
    const graphics = loaded.canvas.getGraphics('select_model');
    expect(graphics).toBeTruthy();

    const screen = loaded.canvas.getViewport().toScreen(centre(loaded.scene, 'select_model'));
    graphics!.dispatchEvent(new dom.window.MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: screen.x,
      clientY: screen.y,
    }) as unknown as Event);

    expect(loaded.cursor.current()).toBe(subPlane(loaded));
    // The canvas's own double-click would have TOGGLED the sub-process open, which
    // writes `isExpanded` and a new `dc:Bounds`. The capture-phase handler stops it.
    expect(sub.di?.isExpanded).toBe(false);
    expect(await toXML(loaded)).toBe(before);
  });

  test('the port publishes the trail, the trip, and the plane on screen as its root', async () => {
    const moddle = freshModdle();
    const canvas = new Canvas();
    const port = createCanvasEditorPort(canvas, {
      model: {
        moddle: () => moddle,
        create: (type: string, props?: Record<string, unknown>) => moddle.create(type, props),
        createBusinessObject: (type: string, props?: Record<string, unknown>) => moddle.create(type, props),
        fromXML: (xml: string) => moddle.fromXML(xml),
        toXML: (definitions: any, options?: { format?: boolean }) => moddle.toXML(definitions, options),
        ids: { nextPrefixed: (prefix: string) => `${prefix}1`, assigned: () => undefined },
      } as any,
    });

    const roots: string[] = [];
    port.events.on('root.set', (event: any) => roots.push(event?.element?.id));
    await port.importXML(exampleXml(EXAMPLE));

    expect(port.view.planePath().map((root) => root.id)).toEqual(['sklearn_pipeline']);
    expect(port.elements.root().id).toBe('sklearn_pipeline');

    // The adapter drew the badges into its own layer inside `overlays`, so an import
    // drops them with everything else (`view.getLayer` re-attaches).
    const badge = canvas.getSvg()
      .querySelector('[data-layer="drilldown"] [data-drilldown="select_model"]');
    expect(badge).toBeTruthy();

    badge!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    const path = port.view.planePath();
    expect(path.map((root) => root.id)).toEqual(['sklearn_pipeline', 'select_model']);
    // `elements.root()` follows the view, so the inspector resolves against the plane
    // on screen rather than the document root — and `root.set` says so.
    expect(port.elements.root().id).toBe('select_model');
    expect(roots[roots.length - 1]).toBe('select_model');

    expect(port.view.goToPlane(path[0])).toBe(true);
    expect(port.elements.root().id).toBe('sklearn_pipeline');
    expect(roots[roots.length - 1]).toBe('sklearn_pipeline');
  });
});
