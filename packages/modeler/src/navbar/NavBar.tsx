import { useContext } from 'react';
import { ModeContext } from '@modeler/app/contexts';
import { Breadcrumbs } from '@modeler/drilldown/Breadcrumbs';
import { AppMenu } from '@modeler/navbar/AppMenu';
import { FileStatus } from '@modeler/navbar/FileStatus';
import { ModeActions } from '@modeler/navbar/ModeActions';
import { row } from '@modeler/navbar/styles';

/**
 * The top row: the study's bar (the app's menu and the file), where you are in the study, and what you can do in the
 * app's mode. This places them; each draws itself.
 */
export function NavBar({ isInspectorVisible, onToggleInspector }: {
  isInspectorVisible: boolean;
  onToggleInspector: () => void;
}) {
  const { mode } = useContext(ModeContext);

  return (
    <div className={row.band}>
      <div className={`${row.bar} ${row.panel} ${row.study}`} data-covers="top">
        <AppMenu />
        {/* The file, not the study: the study's name is the inspector's, shown while nothing is selected. */}
        <div className={row.fileSlot}>
          <FileStatus />
        </div>
      </div>

      {/* A replay drives the view itself, so the trail stands down while one is open. */}
      {mode !== 'replay' && <Breadcrumbs className={row.trail} />}

      <ModeActions className={row.actions} isInspectorVisible={isInspectorVisible} onToggleInspector={onToggleInspector} />
    </div>
  );
}
