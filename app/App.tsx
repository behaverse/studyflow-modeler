import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import '@/assets/icons/studyflow-icons.scss';
import {Modeler} from './modeler/Modeler'
import './styles.css'
import StartUpModal from './modeler/StartUpModal'
import { APIKeyContext, ModelerContext } from './modeler/contexts';
import { NavBar } from './modeler';
import { InspectorPanel } from './modeler/inspector';

export default function App() {

  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const [modeler, setModeler] = useState(undefined);

  if (apiKey === undefined) {
    return (
      <APIKeyContext.Provider value={{apiKey: apiKey, setApiKey: setApiKey}}>
        <div className="App flex flex-col h-screen">
          <StartUpModal />
        </div>
      </APIKeyContext.Provider>
    )
  }

  return (
    <APIKeyContext.Provider value={{apiKey: apiKey, setApiKey: setApiKey}}>
      <ModelerContext.Provider value={{modeler: modeler, setModeler: setModeler}}>
        <div className="App flex flex-col h-screen">
    
          {modeler && <NavBar />}
    
          {/* the modeler */}
          <div className="w-screen h-full">
            <div className="flex flex-row h-full overflow-hidden">
              <Modeler />
              {modeler && <InspectorPanel />}
            </div>
          </div>
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
