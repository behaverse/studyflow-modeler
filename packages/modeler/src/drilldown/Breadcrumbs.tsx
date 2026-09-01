/**
 * The sub-process breadcrumb trail (`scratchpad/subprocess-drilldown-spec.md` §3,
 * `edge-videos/sub/frame_04`).
 *
 * Drilling into a collapsed sub-process switches the canvas to that sub-process's
 * own `bpmndi:BPMNPlane`; this is the way back out. The trail is app chrome for the
 * reason the reference's is: it is a pill of text floating over the diagram, not
 * something drawn in diagram coordinates that a zoom would shrink.
 *
 * It knows nothing about planes beyond what the port publishes —
 * `view.planePath()` for the trail and `view.goToPlane()` for the trip — and it
 * renders nothing at the document root, where the trail is one crumb long.
 *
 * Navigation is VIEW-ONLY: no command, no undo step, no document write (plan
 * §5-D7). `RootSet` is what tells the trail it moved, the same topic an import
 * fires, so an import that lands on the root plane collapses the bar by itself.
 */

import { useCallback, useEffect, useLayoutEffect, useState, Fragment } from 'react';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { goToCrumb, planeCrumbs, type Crumb } from '@modeler/drilldown/commands';
import { breadcrumbs as s } from '@modeler/drilldown/styles';

/**
 * Distance from the canvas's top edge down to the pill.
 *
 * The reference sits it 12px below the top of the diagram viewport
 * (`edge-videos/sub/frame_04`), but this app's canvas container runs the FULL height
 * of the window with the nav bar floating over it (`navBar/NavBar.tsx`: `fixed top-2
 * h-10`). 12px would put the trail underneath that bar, so it takes the first free
 * row below it: 8 + 40 (the bar) + 8.
 */
const TOP = 56;

export function Breadcrumbs() {
  const modeler = useRequiredModeler();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | undefined>(undefined);

  useEffect(() => {
    const sync = (): void => setCrumbs(planeCrumbs(modeler));
    sync();
    modeler.events.on('RootSet', sync);
    modeler.events.on('ImportDone', sync);
    return () => {
      modeler.events.off('RootSet', sync);
      modeler.events.off('ImportDone', sync);
    };
  }, [modeler]);

  /* Centred over the CANVAS, not the window: the palette and the inspector eat into
     the viewport, and a bar centred on the window would sit off-centre over the
     diagram. Re-measured whenever the container resizes — which is also what a panel
     opening or closing does to it. */
  useLayoutEffect(() => {
    const container = modeler.canvas.getContainer();
    if (!container) return;
    const measure = (): void => {
      const rect = container.getBoundingClientRect();
      setAnchor({ left: Math.round(rect.left + rect.width / 2), top: Math.round(rect.top + TOP) });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [modeler, crumbs.length]);

  const go = useCallback((crumb: Crumb) => {
    goToCrumb(modeler, crumb);
  }, [modeler]);

  if (crumbs.length < 2 || !anchor) return null;

  return (
    <div
      className={s.root}
      style={{ left: anchor.left, top: anchor.top }}
      data-testid="drilldown-breadcrumbs"
      aria-label="Diagram plane"
    >
      {crumbs.map((crumb, index) => (
        <Fragment key={crumb.id}>
          {index > 0 && <span className={s.separator} aria-hidden="true">›</span>}
          {crumb.isCurrent ? (
            <span
              className={s.crumbCurrent}
              data-testid={`breadcrumb-${crumb.id}`}
              aria-current="page"
            >
              {crumb.label}
            </span>
          ) : (
            <button
              type="button"
              className={s.crumb}
              data-testid={`breadcrumb-${crumb.id}`}
              onClick={() => go(crumb)}
            >
              {crumb.label}
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}
