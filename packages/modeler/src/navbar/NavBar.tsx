import { useContext } from 'react';
import { ModeContext } from '@modeler/app/contexts';
import { Breadcrumbs } from '@modeler/drilldown/Breadcrumbs';
import { AppMenu } from '@modeler/navbar/AppMenu';
import { FileStatus } from '@modeler/navbar/FileStatus';
import { panels, row } from '@modeler/navbar/styles';
import { ICONS } from '@modeler/icons';
import { showInspector, useInspectorShown } from '@modeler/inspector/visibility';
import { showStoryboard, useStoryboard } from '@modeler/storyboard/store';
import { choice } from '@modeler/ui/styles';

/**
 * The top row: the study's bar (the app's menu and the file), where you are in the study, and the inspector's toggle.
 * This places them; each draws itself. What you can do with the study is the composer's, at the bottom.
 */
export function NavBar() {
  const { mode } = useContext(ModeContext);
  const isInspectorVisible = useInspectorShown();
  const storyboard = useStoryboard();
  const inspectorTitle = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';

  return (
    <div className={row.band}>
      <div className={`${row.bar} ${row.panel} ${row.study}`} data-covers="top">
        <AppMenu />
        {/* The file, not the study: the study's name is the inspector's, shown while nothing is selected. */}
        <div className={row.fileSlot}>
          <FileStatus />
        </div>
      </div>

      {/* Where you are, and whether the study shows as its flow or as its participant's storyboard. A replay drives the
          view itself, so the trail stands down while one is open; the switch is the editor's. */}
      <div className={`${row.trail} ${row.middle}`}>
        {mode !== 'replay' && !storyboard && <Breadcrumbs />}
        {mode === 'edit' && (
          <div className={`${row.bar} ${row.panel} flex`} data-covers="top">
            <div className={choice.track} role="tablist" aria-label="Show the study as">
              {(['Flow', 'Storyboard'] as const).map((label) => {
                const selected = (label === 'Storyboard') === storyboard;
                return (
                  <button
                    key={label}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`${choice.base} ${selected ? choice.selected : choice.idle}`}
                    onClick={() => showStoryboard(label === 'Storyboard')}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* A simulation or a replay hides the inspector, and its toggle with it. */}
      {mode === 'edit' && (
        <div className={`${row.bar} ${row.panel} ${row.actions}`} data-covers="top">
          <button type="button" title={inspectorTitle} aria-label={inspectorTitle} className={panels.toggle} onClick={() => showInspector(!isInspectorVisible)}>
            <i className={`${isInspectorVisible ? ICONS.inspectorHide : ICONS.inspectorShow} ${panels.inspectorIcon}`} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
