import { useState } from 'react';
import { Modeler } from '@modeler/app/Modeler';
import { ModelerContext, ReplayContext, SettingsViewContext } from '@modeler/app/contexts';
import { ReplayPanel } from '@modeler/provenance/Replay';
import { NavBar } from '@modeler/navBar/NavBar';
import { Notices } from '@modeler/app/Notices';
import { Panel as InspectorPanel } from '@modeler/inspector/Panel';
import { Palette } from '@modeler/palette/Palette';
import { SettingsView } from '@modeler/settings/SettingsView';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import type { Modeler as ModelerInstance } from '@modeler/bpmn/types';

export function App() {
  const [modeler, setModeler] = useState<ModelerInstance | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const isSimulating = useIsSimulating(modeler);

  return (
    <ModelerContext.Provider value={{ modeler, setModeler }}>
      <ReplayContext.Provider value={{ isReplaying, openReplay: () => setIsReplaying(true), closeReplay: () => setIsReplaying(false) }}>
      <SettingsViewContext.Provider value={{ openSettings: () => setIsSettingsOpen(true) }}>
        <div className={`App flex flex-col h-screen${isSimulating ? ' simulation-active' : ''}${isReplaying ? ' replay-active' : ''}`} data-testid="modeler-app" data-modeler-ready={modeler ? 'true' : 'false'}>
          {modeler && <div data-testid="modeler-ready" aria-hidden="true" className="hidden" />}
          {modeler && <NavBar />}
          <div className="w-screen h-full">
            <div className="flex flex-row h-full overflow-hidden relative">
              {modeler && <Palette className="md:flex studyflow-palette" />}
              <Modeler />
            </div>
          </div>
          {modeler && !isReplaying && (
            <div className="studyflow-inspector" data-testid="inspector-shell">
              <InspectorPanel />
            </div>
          )}
          {modeler && isReplaying && <ReplayPanel onClose={() => setIsReplaying(false)} />}
          {isSettingsOpen && <SettingsView onClose={() => setIsSettingsOpen(false)} />}
          <Notices />
        </div>
      </SettingsViewContext.Provider>
      </ReplayContext.Provider>
    </ModelerContext.Provider>
  );
}
