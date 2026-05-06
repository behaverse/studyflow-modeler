import { StrictMode, useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import '@/assets/css/app.css'

import { Modeler } from './modeler/Modeler'
import { APIKeyContext, ModelerContext, SettingsViewContext } from './modeler/contexts';
import { NavBar } from './modeler/navbar';
import { InspectorPanel } from './modeler/inspector';
import { Palette } from './modeler/palette';
import { SettingsView } from './modeler/settings';
import { getStoredApiKey, setStoredApiKey } from './modeler/settings/store';

function App() {
  const [apiKey, setApiKeyState] = useState<string | undefined>(undefined);
  const [modeler, setModeler] = useState(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    setApiKeyState(getStoredApiKey() ?? 'guest');
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    setStoredApiKey(key);
  }, []);

  if (apiKey === undefined) {
    return null;
  }

  return (
    <APIKeyContext.Provider value={{apiKey: apiKey, setApiKey: setApiKey}}>
      <ModelerContext.Provider value={{modeler: modeler, setModeler: setModeler}}>
        <SettingsViewContext.Provider value={{
          isSettingsOpen,
          openSettings: () => setIsSettingsOpen(true),
          closeSettings: () => setIsSettingsOpen(false),
        }}>
          <div className="App flex flex-col h-screen" data-testid="modeler-app" data-modeler-ready={modeler ? 'true' : 'false'}>
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
    </APIKeyContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
