/**
 * `Canvas` — the top-level facade (design §3 `Canvas.ts`, §6 P1). Owns the scene,
 * the SVG root + layer stack, the viewport, and the renderer. For P1 it is
 * read-only: {@link Canvas.importDefinitions} builds a {@link Scene} from a
 * `bpmn:Definitions` moddle tree (with DI) and renders it; there is no interaction,
 * selection, or writeback yet (those arrive in P2/P3, design §6).
 *
 * The SVG DOM is created via {@link svg} helpers, which default to the global
 * `document` (present under the playwright/chromium test DOM) and can be swapped
 * with `setDocument` for a headless harness.
 */

import { importDefinitions } from '@canvas/model/import.ts';
import type { ImportOptions } from '@canvas/model/import.ts';
import type { ModdleObject, Scene, SceneElement } from '@canvas/model/scene.ts';
import { append, create, ownerDocument } from '@canvas/render/svg.ts';
import { ensureArrowMarkers, Renderer } from '@canvas/render/renderer.ts';
import type { RendererOptions } from '@canvas/render/renderer.ts';
import { Layers } from '@canvas/view/layers.ts';
import { sceneBounds, Viewport } from '@canvas/view/viewport.ts';

/** Options for constructing a {@link Canvas}. */
export interface CanvasOptions extends RendererOptions {
  /** Host element the SVG root is appended to. A detached `<div>` is created if omitted. */
  container?: HTMLElement;
  /** Import-time warning sink, forwarded to {@link importDefinitions}. */
  onWarning?: ImportOptions['onWarning'];
}

/** Read-only editable-SVG canvas (P1). */
export class Canvas {
  private readonly container: HTMLElement;
  private readonly root: SVGSVGElement;
  private readonly layers: Layers;
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  private readonly onWarning?: ImportOptions['onWarning'];
  private scene?: Scene;

  constructor(options: CanvasOptions = {}) {
    const doc = ownerDocument();
    this.container = options.container ?? doc.createElement('div');
    this.onWarning = options.onWarning;

    this.root = create('svg', {
      class: 'sf-canvas',
      width: '100%',
      height: '100%',
      preserveAspectRatio: 'xMidYMid meet',
    }) as SVGSVGElement;
    this.root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    append(this.container, this.root);

    this.layers = new Layers(this.root);
    ensureArrowMarkers(this.layers.defs);
    this.viewport = new Viewport(this.root, this.container);
    this.renderer = new Renderer(options);
  }

  /**
   * Build a {@link Scene} from `definitions` (a `bpmn:Definitions` moddle tree that
   * already carries DI) and render it read-only, then fit the viewport. Returns the
   * scene.
   */
  importDefinitions(definitions: ModdleObject): Scene {
    this.scene = importDefinitions(definitions, { onWarning: this.onWarning });
    this.layers.clear();
    this.renderer.renderScene(
      this.scene,
      this.layers.getLayer('shapes'),
      this.layers.getLayer('connections'),
    );
    this.zoomToFit();
    return this.scene;
  }

  /** The current scene, or `undefined` before an import. */
  getScene(): Scene | undefined {
    return this.scene;
  }

  /** The host element the SVG root lives in. */
  getContainer(): HTMLElement {
    return this.container;
  }

  /** The root `<svg>` element. */
  getSvg(): SVGSVGElement {
    return this.root;
  }

  /** The viewport (pan/zoom/transforms). */
  getViewport(): Viewport {
    return this.viewport;
  }

  /** The `<g>` rendered for an element id, if any. */
  getGraphics(id: string): SVGGElement | undefined {
    return this.renderer.graphicsById.get(id);
  }

  /** Fit the viewport to every rendered element (with padding). */
  zoomToFit(padding = 40): void {
    if (!this.scene) return;
    const elements: SceneElement[] = [];
    for (const element of this.scene.elementsById.values()) {
      if (element.kind === 'node' || element.kind === 'edge') elements.push(element);
    }
    this.viewport.fitBounds(sceneBounds(elements), padding);
  }

  /** Serialize the live canvas SVG to a string (design §4 `saveSVG`). */
  toSVG(): string {
    const doc = ownerDocument();
    const view = (doc.defaultView ?? (typeof window !== 'undefined' ? window : undefined)) as
      | (Window & typeof globalThis)
      | undefined;
    if (view && typeof view.XMLSerializer === 'function') {
      return new view.XMLSerializer().serializeToString(this.root);
    }
    // Fallback for a DOM without XMLSerializer.
    return this.root.outerHTML ?? '';
  }
}
