import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './assets/icons/studyflow-icons.scss';
import {Modeler} from './modeler/Modeler'
import './styles.scss'
import StartUpModal from './modeler/StartUpModal'
import { APIKeyContext, ModelerContext } from './modeler/contexts';
import { Navbar } from './modeler';
import { PropertiesPanel } from './modeler/properties';

export default function App() {

  const [apiKey, setApiKey] = useState(null);
  const [modeler, setModeler] = useState(null);

  if (apiKey === null) {
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
  
      {/* the navbar */}
      <Navbar />
  
      {/* the modeler */}
          <div className="w-screen h-full">
          <div className="flex flex-row h-full overflow-hidden">
              <Modeler />
              {modeler && <PropertiesPanel />}
          </div>
      </div>
      </div>
      </ModelerContext.Provider>
      </APIKeyContext.Provider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
