import { useState } from 'react';
import { Modeler } from '@/modeler/app/Modeler';
import { ModelerContext, SettingsViewContext } from '@/modeler/app/contexts';
import { NavBar } from '@/modeler/navBar/NavBar';
import { Notices } from '@/modeler/app/Notices';
import { Panel as InspectorPanel } from '@/modeler/inspector/Panel';
import { Palette } from '@/modeler/palette/Palette';
import { SettingsView } from '@/modeler/settings/SettingsView';
import { useIsSimulating } from '@/modeler/simulation/useIsSimulating';
import type { Modeler as ModelerInstance } from '@/modeler/bpmn/types';

export function App() {
  const [modeler, setModeler] = useState<ModelerInstance | undefined>(undefined);
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
          <Notices />
        </div>
      </SettingsViewContext.Provider>
    </ModelerContext.Provider>
  );
}
