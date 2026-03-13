import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import {Modeler} from './v1/Modeler'
import '@/assets/css/app.css'
import { APIKeyContext, ModelerContext } from './v1/contexts';
import { NavBar } from './v1/navbar';
import { InspectorPanel } from './v1/inspector';
import { Palette } from './v1/palette';
import { executeCommand } from './v1/commands';

export default function App() {

  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const [modeler, setModeler] = useState(undefined);

  // Auto-login as guest on mount
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

          {/* the modeler */}
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

        </div>
      </ModelerContext.Provider>
    </APIKeyContext.Provider>
  )
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
