/**
 * A React key for "this inspected element" that survives its own edits.
 *
 * Keying fields by `element.id` made typing in the ID field remount every
 * field on each keystroke (the key changed under the focused input), so the
 * box lost focus after one character. The identity that actually matters is
 * the element *instance* — stable while its attributes change, different when
 * the selection moves — so hand out one token per object.
 */
const tokens = new WeakMap<object, number>();
let next = 0;

export function elementKey(element: object | null | undefined): string {
  if (!element || typeof element !== 'object') return 'none';
  let token = tokens.get(element);
  if (token === undefined) {
    next += 1;
    token = next;
    tokens.set(element, token);
  }
  return `el${token}`;
}
