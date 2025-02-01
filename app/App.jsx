import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import logo_image from './assets/logo.png'
import {Modeler} from './Modeler'
import './index.css'
import StartUpModal from './StartUpModal'
import { APIKeyContext, ModelerContext } from './contexts';
import { Toolbar } from './studyflow';
import { PropertiesPanel } from './studyflow/properties';

import { Menu, MenuItem, MenuItems, MenuButton } from '@headlessui/react';

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
  
        {/* top navbar */}
      <nav className="w-full flow-root bg-stone-100 border-b border-stone-200">
        <div className="float-left flex flex-wrap">
        <a href="/" className="flex space-x-2">
          <img src={logo_image} className="h-16 p-1" alt="Logo" />
          </a>
          <span className="self-center font-light text-2xl text-stone-700 px-3">
            StudyFlow<span className="font-semibold">Modeler</span>
          </span>
          </div>
        {/* <div className="flex flex-wrap float-start h-full items-center ms-4">
          <span className="text-stone-300"></span>
          <a href="/docs" className="flex p-2 text-stone-600 hover:text-stone-900">Docs</a>
          <span className="text-stone-300">&bull;</span>
          <a href="https://github.com/behaverse/studyflow-modeler" className="flex p-2 text-stone-600 hover:text-stone-900">GitHub</a>
          <span className="text-stone-300">&bull;</span>
          <a href="/about/" className="flex p-2 pr-4 text-stone-600 hover:text-stone-900">About</a>    
        </div> */}
        <div className="flex flex-wrap float-end h-full items-center p-3">
              {modeler && <Toolbar />}    
              <Menu as="div" title="More info">
              <MenuButton className="h-9 bg-stone-200 hover:bg-stone-300 border border-stone-300 text-black rounded py-1 px-3 ms-1">
                <i className="bi bi-three-dots text-black"></i></MenuButton>
          <MenuItems anchor="bottom end" className="w-52 bg-stone-200 border border-stone-300 rounded-lg [--anchor-gap:4px]">
            <MenuItem>
              <a href="/docs" target="_blank" className="p-2 block data-[focus]:bg-stone-300">Docs</a>
            </MenuItem>
            <MenuItem>
              <a href="https://github.com/behaverse/studyflow-modeler" target="_blank" className="p-2 block data-[focus]:bg-stone-300">GitHub</a>
                </MenuItem>
                <MenuItem>
              <a href="/about" target="_blank" className="p-2 block data-[focus]:bg-stone-300">About</a>
            </MenuItem>
          </MenuItems>
              </Menu>
          </div>
      </nav>
  
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
