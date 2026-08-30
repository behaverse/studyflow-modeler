/**
 * Tiny SVG DOM helpers (design §3 `render/svg.ts`) — a self-contained stand-in for
 * `tiny-svg` so the canvas ships no rendering dependency. `create`/`attr`/`append`/
 * `transform`/`clear`/`remove` cover everything the ported drawers need.
 *
 * SVG elements must be created in the SVG namespace; `foreignObject` children live
 * in the HTML namespace. The active {@link Document} defaults to the global one
 * (present under the playwright/chromium test DOM) but can be swapped with
 * {@link setDocument} for a headless harness — no other browser-only global is
 * touched at module load.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

let activeDoc: Document | undefined =
  typeof document !== 'undefined' ? document : undefined;

/** Override the {@link Document} used to mint elements (for a non-global DOM). */
export function setDocument(doc: Document): void {
  activeDoc = doc;
}

/** The {@link Document} used to mint elements; throws with a clear hint if none is set. */
export function ownerDocument(): Document {
  if (!activeDoc) {
    throw new Error(
      '@behaverse/studyflow-canvas: no DOM Document available. '
        + 'Run in a DOM environment or call setDocument() first.',
    );
  }
  return activeDoc;
}

/** Attribute values accepted by {@link attr}; numbers are stringified. */
export type AttrValue = string | number | boolean | null | undefined;

/** Set (or, when the value is `null`/`undefined`, remove) attributes on an element. */
export function attr<E extends Element>(element: E, attrs: Record<string, AttrValue>): E {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      element.removeAttribute(name);
      continue;
    }
    element.setAttribute(name, String(value));
  }
  return element;
}

/** Create an SVG element of `name`, optionally applying `attrs`. */
export function create<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs?: Record<string, AttrValue>,
): SVGElementTagNameMap[K];
export function create(name: string, attrs?: Record<string, AttrValue>): SVGElement;
export function create(name: string, attrs?: Record<string, AttrValue>): SVGElement {
  const element = ownerDocument().createElementNS(SVG_NS, name) as SVGElement;
  if (attrs) attr(element, attrs);
  return element;
}

/** Create an HTML element (for `foreignObject` content). */
export function createHtml<K extends keyof HTMLElementTagNameMap>(
  name: K,
): HTMLElementTagNameMap[K] {
  return ownerDocument().createElement(name);
}

/** Append `child` to `parent`, returning `child`. */
export function append<E extends Node>(parent: Node, child: E): E {
  parent.appendChild(child);
  return child;
}

/** Remove `element` from its parent, if any. */
export function remove(element: Node | null | undefined): void {
  if (element && element.parentNode) element.parentNode.removeChild(element);
}

/** Remove every child of `element`. */
export function clear<E extends Node>(element: E): E {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

/** Apply a `translate(x,y)` (optionally `scale`) transform to a group. */
export function transform(element: SVGElement, x: number, y: number, scale?: number): void {
  const t = scale !== undefined && scale !== 1
    ? `translate(${x}, ${y}) scale(${scale})`
    : `translate(${x}, ${y})`;
  element.setAttribute('transform', t);
}

/** Create a `<g>` translated to `(x, y)`, optionally carrying `attrs`. */
export function group(x = 0, y = 0, attrs?: Record<string, AttrValue>): SVGGElement {
  const g = create('g', attrs) as SVGGElement;
  if (x || y) transform(g, x, y);
  return g;
}

/** Add space-separated class tokens to an element. */
export function classed(element: Element, ...names: string[]): void {
  for (const name of names) if (name) element.classList.add(name);
}
