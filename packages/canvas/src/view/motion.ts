/**
 * The canvas's motion: short and eased, only ever showing what a change did (the camera moving, an element moving,
 * coming or going), and none at all where the person asked for reduced motion or the page cannot animate.
 */

/** How long each kind of change takes to show, in milliseconds. */
export const DURATION = { camera: 240, move: 220, enter: 160, leave: 140 } as const;

/** Quick to start, soft to land: CSS's form, for the Web Animations the elements run. */
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/** The same curve's shape for a step the camera takes itself, `t` from 0 to 1. */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Whether `node`'s page animates: a browser that can, where the person has not asked for reduced motion. */
export function moves(node: Node): boolean {
  const view = node.ownerDocument?.defaultView;
  return !!view
    && typeof view.matchMedia === 'function'
    && typeof view.requestAnimationFrame === 'function'
    && !view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animates(el: Element): boolean {
  return typeof (el as Partial<Animatable>).animate === 'function' && moves(el);
}

/** Show `g`, drawn at `to`, travelling there from `from`: the translations its `transform` holds. */
export function slide(g: SVGGElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  if (!animates(g) || (from.x === to.x && from.y === to.y)) return;
  g.animate(
    [{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: `translate(${to.x}px, ${to.y}px)` }],
    { duration: DURATION.move, easing: EASING },
  );
}

/** Show `el` arriving: from the faintness a ghost is drawn with to its own ink. */
export function enter(el: Element): void {
  if (!animates(el)) return;
  el.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: DURATION.enter, easing: EASING });
}

/** Show `el`, redrawn where the shapes it joins are travelling to, once they are there. */
export function follow(el: Element): void {
  if (!animates(el)) return;
  const arrive = DURATION.move / (DURATION.move + DURATION.enter);
  el.animate([{ opacity: 0 }, { opacity: 0, offset: arrive }, { opacity: 1 }], { duration: DURATION.move + DURATION.enter, easing: EASING });
}

/** Show `el` leaving, then remove it; a page that does not animate removes it at once. */
export function leave(el: Element): void {
  if (!animates(el)) {
    el.remove();
    return;
  }
  el.setAttribute('pointer-events', 'none');
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION.leave, easing: EASING }).finished
    .catch(() => undefined)
    .finally(() => el.remove());
}
