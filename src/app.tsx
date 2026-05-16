import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import '@/assets/css/app.css'

import { Modeler } from './modeler/Modeler'
import { ModelerContext, SettingsViewContext } from './modeler/contexts';
import { NavBar } from './modeler/navbar';
import { InspectorPanel } from './modeler/inspector';
import { Palette } from './modeler/palette';
import { SettingsView } from './modeler/settings';
import { useIsSimulating } from './modeler/simulation/useIsSimulating';

function App() {
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
