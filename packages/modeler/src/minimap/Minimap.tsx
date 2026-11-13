/**
 * The minimap: the whole diagram small, with the elements `focus` names ringed on it, so a view that walks the
 * canvas elsewhere (the provenance replay) shows where it is. It is a second, read-only view of the same study, so
 * it draws each edit as the canvas does and fits itself after each change. It shows the main diagram only, never a
 * drilled-into sub-process: an element inside a collapsed container is ringed as the outermost collapsed container
 * it lies in. It swallows pointer and wheel events, so the map itself never selects, pans or zooms. It draws in a
 * closed shadow root, which keeps its second copy of each element out of the page's element lookups; `data-focus`
 * on it says what it rings.
 *
 * Its host places it: `className` positions it, and `covers` names the edge of the canvas it covers, so a fit keeps
 * the diagram clear of it (`mount.ts coveredEdges`).
 */

import { useEffect, useRef } from 'react';
import { Canvas, type Bounds, type ElementRecord, type Study } from '@canvas/index.ts';
import { useModeler } from '@modeler/app/useModeler';
import { FOCUS_RING, MAP_CSS, minimap as s } from '@modeler/minimap/styles';

type Props = {
  /** The ids of the elements to ring. */
  focus: readonly string[];
  /** Classes from its host that position it. */
  className?: string;
  /** The edge of the canvas it covers. */
  covers?: 'top' | 'right' | 'bottom' | 'left';
};

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The map's own layer, over the diagram it draws. */
const LAYER = 'minimap-focus';
/** The events the map would otherwise act on: select, pan, zoom, hover. */
const PRESSES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'dblclick'] as const;
/** How far a ring stands off what it rings, and how small it may be, in screen pixels. */
const RING_GAP = 3;
const RING_MIN = 10;
/** A host takes one shadow root for good: a remount (React's strict mode runs each effect twice) reuses it. */
const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();

/** The element the main diagram draws for `id`: the element itself, or the outermost collapsed container it lies in. */
function onMainPlane(study: Study, id: string): ElementRecord | undefined {
  let element = study.get(id);
  while (element?.plane) element = study.get(element.plane);
  return element;
}

/** An element's box: a shape's own bounds, or the box round a flow's route. */
function boxOf(element: ElementRecord): Bounds | undefined {
  if (element.bounds) return element.bounds;
  const points = element.waypoints ?? [];
  if (points.length === 0) return undefined;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function Minimap({ focus, className = '', covers }: Props) {
  const modeler = useModeler();
  const host = useRef<HTMLDivElement>(null);
  /** Rings these ids; a no-op until the map has drawn. */
  const ring = useRef<(ids: readonly string[]) => void>(() => {});
  const focused = useRef<readonly string[]>([]);

  useEffect(() => {
    const container = host.current;
    if (!container) return undefined;
    const doc = container.ownerDocument;
    const shadow = shadowRoots.get(container) ?? container.attachShadow({ mode: 'closed' });
    shadowRoots.set(container, shadow);
    const style = doc.createElement('style');
    style.textContent = MAP_CSS;
    const view = doc.createElement('div');
    shadow.replaceChildren(style, view);
    const map = new Canvas(view, modeler.study, { editable: false, iconResolver: () => null });

    // A redraw (a load, an undo) drops the host's layers, so the layer is asked for on every call.
    ring.current = (ids) => {
      focused.current = ids;
      const layer = map.layer(LAYER);
      layer.replaceChildren();
      const { scale } = map.viewbox;
      for (const id of ids) {
        const element = modeler.study.get(id);
        const box = element && boxOf(element);
        if (!box) continue;
        const width = Math.max(box.width + (2 * RING_GAP) / scale, RING_MIN / scale);
        const height = Math.max(box.height + (2 * RING_GAP) / scale, RING_MIN / scale);
        const at = { x: box.x + box.width / 2 - width / 2, y: box.y + box.height / 2 - height / 2, width, height, rx: 3 / scale };
        const rect = doc.createElementNS(SVG_NS, 'rect');
        for (const [name, value] of Object.entries({ ...FOCUS_RING, ...at })) rect.setAttribute(name, String(value));
        layer.append(rect);
      }
    };
    const fit = (): void => {
      map.zoom('fit');
      ring.current(focused.current);
    };
    fit();
    const stopHearing = [modeler.study.on('change', fit)];

    // Caught in the capture phase, so the map's own gestures never receive them.
    const swallow = (event: Event): void => {
      event.stopPropagation();
      if (event.type === 'wheel' || event.type === 'pointerdown') event.preventDefault();
    };
    for (const type of PRESSES) container.addEventListener(type, swallow, { capture: true, passive: false });
    return () => {
      for (const type of PRESSES) container.removeEventListener(type, swallow, { capture: true });
      for (const stop of stopHearing) stop();
      ring.current = () => {};
      map.destroy();
      shadow.replaceChildren();
    };
  }, [modeler]);

  // The ids to ring: each element as the main diagram draws it, without duplicates.
  const key = [...new Set(focus.flatMap((id) => onMainPlane(modeler.study, id)?.id ?? []))].join(' ');
  useEffect(() => {
    ring.current(key ? key.split(' ') : []);
  }, [key]);

  return <div ref={host} className={`${s.root} ${className}`} data-testid="minimap" data-focus={key} data-covers={covers} aria-hidden="true" />;
}
