/**
 * The drawer under the canvas: one view of the study at a time (the schedule, the checklists, the provenance), between
 * the tools and the inspector, the composer above it. Each view follows the selection, and a press on a row selects
 * its element on the canvas. Maximized, it stands as a dialog over the app, for a view that needs the room; Esc or its
 * backdrop puts it back.
 */

import { useEffect } from 'react';
import { ChecklistView } from '@modeler/checklist/Checklist';
import { ProvenanceView } from '@modeler/provenance/Provenance';
import { ScheduleView } from '@modeler/schedule/Schedule';
import { useInspectorWidth } from '@modeler/inspector/visibility';
import { ICONS } from '@modeler/icons';
import { VIEWS, closeView, maximizeViews, openView, useViews } from '@modeler/views/store';
import { drawer as s } from '@modeler/views/styles';

/** Where the drawer ends on the right: clear of the inspector while it shows. */
const GAP = 8;

export function Drawer() {
  const { open, maximized } = useViews();
  const inspector = useInspectorWidth();

  // Esc puts a maximized drawer back before anything else hears it.
  useEffect(() => {
    if (!open || !maximized) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      maximizeViews(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, maximized]);

  if (!open) return null;

  return (
    <>
      {maximized && <div className={s.backdrop} onClick={() => maximizeViews(false)} aria-hidden="true" />}
      <section
        className={maximized ? s.rootMaximized : s.root}
        style={maximized ? undefined : { right: inspector > 0 ? inspector + 2 * GAP : GAP }}
        data-covers={maximized ? undefined : 'bottom'}
        data-testid="views-drawer"
        aria-label="Views"
        {...(maximized ? { role: 'dialog', 'aria-modal': true } : {})}
      >
        <header className={s.header}>
          <div className={s.tabs} role="tablist" aria-label="Views">
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={open === id}
                className={`${s.tab} ${open === id ? s.tabSelected : s.tabIdle}`}
                onClick={() => openView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={s.controls}>
            <button
              type="button"
              className={s.close}
              title={maximized ? 'Back under the canvas' : 'Fill the window'}
              aria-label={maximized ? 'Restore views' : 'Maximize views'}
              onClick={() => maximizeViews(!maximized)}
            >
              <i className={maximized ? ICONS.fullscreenExit : ICONS.fullscreen} aria-hidden="true" />
            </button>
            <button type="button" className={s.close} title="Close" aria-label="Close views" onClick={closeView}>
              <i className={ICONS.close} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className={s.body} role="tabpanel">
          {open === 'schedule' && <ScheduleView />}
          {open === 'checklist' && <ChecklistView />}
          {open === 'provenance' && <ProvenanceView />}
        </div>
      </section>
    </>
  );
}
