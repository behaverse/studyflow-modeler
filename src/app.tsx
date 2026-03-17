import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import '@/assets/css/app.css'

// v1 imports
import { Modeler as V1Modeler } from './v1/Modeler'
import { APIKeyContext, ModelerContext } from './v1/contexts';
import { NavBar } from './v1/navbar';
import { InspectorPanel as V1InspectorPanel } from './v1/inspector';
import { Palette as V1Palette } from './v1/palette';
import { executeCommand } from './v1/commands';

// v2 imports
import { Modeler as V2Modeler } from './v2/Modeler';
import { Palette as V2Palette } from './v2/palette/Palette';
import { InspectorPanel as V2InspectorPanel } from './v2/inspector/Panel';
import { NavBar as V2NavBar } from './v2/navbar';
import { useModelerStore } from './v2/store';

/** Detect engine version from URL param or env var. */
function getEngine(): 'v1' | 'v2' {
  const params = new URLSearchParams(window.location.search);
  const urlEngine = params.get('engine');
  if (urlEngine === 'v2') return 'v2';
  if (urlEngine === 'v1') return 'v1';
  if (import.meta.env.VITE_ENGINE === 'v2') return 'v2';
  return 'v1';
}

function V1App() {
  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const [modeler, setModeler] = useState(undefined);

  useEffect(() => {
    executeCommand(null, { type: 'login-as-guest' })
      .then((result: any) => {
        if (result?.success && result?.data?.apiKey !== undefined) {
          setApiKey(result.data.apiKey);
        }
      });
  }, []);

  if (apiKey === undefined) {
    return null;
  }

  return (
    <APIKeyContext.Provider value={{apiKey: apiKey, setApiKey: setApiKey}}>
      <ModelerContext.Provider value={{modeler: modeler, setModeler: setModeler}}>
        <div className="App flex flex-col h-screen" data-testid="modeler-app" data-modeler-ready={modeler ? 'true' : 'false'}>
          {modeler && <div data-testid="modeler-ready" aria-hidden="true" className="hidden" />}
          {modeler && <NavBar />}
          <div className="w-screen h-full">
            <div className="flex flex-row h-full overflow-hidden relative">
              {modeler && <V1Palette className="md:flex studyflow-palette" />}
              <V1Modeler />
            </div>
          </div>
          {modeler && (
            <div className="studyflow-inspector" data-testid="inspector-shell">
              <V1InspectorPanel />
            </div>
          )}
        </div>
      </ModelerContext.Provider>
    </APIKeyContext.Provider>
  );
}

function V2App() {
  const isReady = useModelerStore((s) => s.isReady);

  return (
    <div className="App flex flex-col h-screen" data-testid="modeler-app" data-modeler-ready={isReady ? 'true' : 'false'}>
      {isReady && <div data-testid="modeler-ready" aria-hidden="true" className="hidden" />}
      {isReady && <V2NavBar />}

      <div className="w-screen h-full">
        <div className="flex flex-row h-full overflow-hidden relative">
          {isReady && <V2Palette className="md:flex studyflow-palette" />}
          <V2Modeler />
        </div>
      </div>

      {isReady && (
        <div className="studyflow-inspector" data-testid="inspector-shell">
          <V2InspectorPanel />
        </div>
      )}
    </div>
  );
}

export default function App() {
  const engine = getEngine();
  return engine === 'v2' ? <V2App /> : <V1App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
