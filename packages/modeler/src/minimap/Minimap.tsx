/**
 * The minimap: the whole diagram small in the corner, with the region the canvas shows marked on it; a press or a
 * drag on it moves the canvas there. It is a second, read-only view of the same study, so it draws each edit as the
 * canvas does; it hears none of its own presses (they move the canvas instead), follows the canvas into a
 * sub-process, and fits itself to what it draws after each change. It draws in a closed shadow root, so its second
 * drawing of each element stays out of whatever looks the page's elements up. The `minimap` setting shows it.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Canvas, type Bounds } from '@canvas/index.ts';
import { useModeler } from '@modeler/app/useModeler';
import { MAP_CSS, minimap as s, VIEW_MARK } from '@modeler/minimap/styles';
import { getSettings, subscribeSettings } from '@modeler/settings/store';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The map's own layer, over the diagram it draws. */
const LAYER = 'minimap-view';
/** What the map would otherwise do itself: select, pan, zoom, hover. */
const PRESSES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'dblclick'] as const;
/** A host takes one shadow root for good: a remount (React's strict mode runs each effect twice) reuses it. */
const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();

export function Minimap() {
  const modeler = useModeler();
  const { minimap: isShown } = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!isShown || !container) return undefined;
    const main = modeler.canvas;
    const doc = container.ownerDocument;
    const shadow = shadowRoots.get(container) ?? container.attachShadow({ mode: 'closed' });
    shadowRoots.set(container, shadow);
    const style = doc.createElement('style');
    style.textContent = MAP_CSS;
    const view = doc.createElement('div');
    shadow.replaceChildren(style, view);
    const map = new Canvas(view, modeler.study, { editable: false, iconResolver: () => null });
    const mark = doc.createElementNS(SVG_NS, 'rect');
    for (const [name, value] of Object.entries(VIEW_MARK)) mark.setAttribute(name, value);

    // A view drawn afresh (a load, an undo) lets its host layers go: asked for again, the layer comes back.
    const markRegion = (region: Bounds): void => {
      map.layer(LAYER).append(mark);
      for (const [name, value] of Object.entries(region)) mark.setAttribute(name, String(value));
    };
    const fit = (): void => {
      map.setScope(main.scope);
      map.zoom('fit');
      markRegion(main.viewbox.shown);
    };
    fit();
    const stopHearing = [
      main.on('camera', (camera) => markRegion(camera.shown)),
      main.on('scope', fit),
      modeler.study.on('change', fit),
    ];

    // A press, and a drag after it, centre the canvas on the point under the pointer.
    let pressed = false;
    const centre = (event: PointerEvent): void => {
      const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(map.layer(LAYER).getScreenCTM()!.inverse());
      const { width, height } = main.viewbox;
      main.setViewbox({ x: at.x - width / 2, y: at.y - height / 2, width, height });
    };
    const onPress = (event: Event): void => {
      // Caught on the way down, so the map's own gestures never hear it.
      event.stopPropagation();
      if (event.type === 'wheel') event.preventDefault();
      if (!(event instanceof PointerEvent)) return;
      if (event.type === 'pointerdown') {
        event.preventDefault();
        pressed = true;
        container.setPointerCapture?.(event.pointerId);
      }
      if (event.type === 'pointerup' || event.type === 'pointercancel') pressed = false;
      else if (pressed) centre(event);
    };
    for (const type of PRESSES) container.addEventListener(type, onPress, { capture: true, passive: false });
    return () => {
      for (const type of PRESSES) container.removeEventListener(type, onPress, { capture: true });
      for (const stop of stopHearing) stop();
      map.destroy();
      shadow.replaceChildren();
    };
  }, [modeler, isShown]);

  if (!isShown) return null;
  return <div ref={host} className={s.root} data-testid="minimap" aria-hidden="true" />;
}
