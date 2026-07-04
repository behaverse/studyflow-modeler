import { useState } from 'react';
import { Modeler } from '@/modeler/views/Modeler';
import { ModelerContext, SettingsViewContext } from '@/modeler/infra/contexts';
import { NavBar } from '@/modeler/views/navbar';
import { InspectorPanel } from '@/modeler/views/inspector';
import { Palette } from '@/modeler/views/palette';
import { SettingsView } from '@/modeler/views/settings';
import { useIsSimulating } from '@/modeler/views/simulation/useIsSimulating';

export function App() {
  const [modeler, setModeler] = useState(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isSimulating = useIsSimulating(modeler);

  return (
    <ModelerContext.Provider value={{ modeler, setModeler }}>
      <SettingsViewContext.Provider value={{ openSettings: () => setIsSettingsOpen(true) }}>
        <div className={`App flex flex-col h-screen${isSimulating ? ' simulation-active' : ''}`} data-testid="modeler-app" data-modeler-ready={modeler ? 'true' : 'false'}>
          {modeler && <div data-testid="modeler-ready" aria-hidden="true" className="hidden" />}
          {modeler && <NavBar />}
          <div className="w-screen h-full">
            <div className="flex flex-row h-full overflow-hidden relative">
              {modeler && <Palette className="md:flex studyflow-palette" />}
              <Modeler />
            </div>
          </div>
          {modeler && (
            <div className="studyflow-inspector" data-testid="inspector-shell">
              <InspectorPanel />
            </div>
          )}
          {isSettingsOpen && <SettingsView onClose={() => setIsSettingsOpen(false)} />}
        </div>
      </SettingsViewContext.Provider>
    </ModelerContext.Provider>
  );
}
