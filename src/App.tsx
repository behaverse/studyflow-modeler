import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import '@/assets/icons/studyflow-icons.scss';
import {Modeler} from './v1/Modeler'
import '@/assets/css/app.css'
import StartUpModal from './v1/StartUpModal'
import { APIKeyContext, ModelerContext } from './v1/contexts';
import { NavBar } from './v1';
import { InspectorPanel } from './v1/inspector';

interface InspectorToggleButtonProps {
  isInspectorVisible: boolean;
  onClick: () => void;
}

function InspectorToggleButton({ isInspectorVisible, onClick }: InspectorToggleButtonProps) {

  const position = isInspectorVisible ? 'right-[0.5rem]' : 'right-[0.5rem]';
  const title = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
  const icon = isInspectorVisible ? 'bi-arrow-bar-right' : 'bi-arrow-bar-left';

  return (
    <button
      onClick={onClick}
      className={`absolute ${position} top-2 bg-stone-150 hover:bg-stone-300 text-stone-700 p-2 rounded z-50`}
      title={title}
    >
      <i className={`bi ${icon}`}></i>
    </button>
  );
}

export default function App() {

  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  const [modeler, setModeler] = useState(undefined);
  const [inspectorVisible, setInspectorVisible] = useState(true);

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
            <div className="flex flex-row h-full overflow-hidden relative">
              <Modeler />
              {modeler && (
                <>
                  <InspectorToggleButton
                    isInspectorVisible={inspectorVisible}
                    onClick={() => setInspectorVisible(!inspectorVisible)}
                  />
                  <InspectorPanel className={inspectorVisible ? '' : 'hidden'} />
                </>
              )}
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
