/**
 * The sub-process breadcrumb trail: drilling into a collapsed sub-process shows only its
 * contents (the canvas's scope), and this is the way back out. It is app chrome, the middle
 * of the nav bar's row, so a zoom never shrinks it.
 *
 * It reads `canvas.scopePath` and moves with `canvas.setScope()` (drilldown/commands.ts),
 * and renders nothing at the document root, where the trail is one crumb long. Navigation
 * writes nothing: no command, no undo step. `RootSet` tells the trail it moved, the same
 * topic an import fires, so an import collapses the bar by itself; an edit re-reads its
 * names, so a rename shows at once.
 */

import { useCallback, useEffect, useState, Fragment } from 'react';
import { useModeler } from '@modeler/app/useModeler';
import { goToCrumb, planeCrumbs, type Crumb } from '@modeler/drilldown/commands';
import { breadcrumbs as s } from '@modeler/drilldown/styles';

/** `className` places it in the nav bar's row. */
export function Breadcrumbs({ className = '' }: { className?: string }) {
  const modeler = useModeler();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  useEffect(() => {
    const sync = (): void => setCrumbs(planeCrumbs(modeler));
    sync();
    modeler.events.on('RootSet', sync);
    modeler.events.on('ImportDone', sync);
    modeler.events.on('ElementsChanged', sync);
    return () => {
      modeler.events.off('RootSet', sync);
      modeler.events.off('ImportDone', sync);
      modeler.events.off('ElementsChanged', sync);
    };
  }, [modeler]);

  const go = useCallback((crumb: Crumb) => {
    goToCrumb(modeler, crumb);
  }, [modeler]);

  if (crumbs.length < 2) return null;

  return (
    <div
      className={`${s.root} ${className}`}
      data-testid="drilldown-breadcrumbs"
      data-covers="top"
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
