import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap-icons/font/bootstrap-icons.css'
import logo_image from './assets/logo.png'
import {Modeler} from './Modeler'
import './index.css'
import StartUpModal from './StartUpModal'
import { APIKeyContext } from './contexts';

export default function App() {

  const [apiKey, setApiKey] = useState(null);

  console.log(setApiKey);

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
    <div className="App flex flex-col h-screen">
  
        {/* top navbar */}
      <nav className="w-full flow-root bg-gray-50 border-b border-gray-200">
        <div className="float-left flex flex-wrap">
        <a href="/" className="flex space-x-2">
          <img src={logo_image} className="h-16 p-1" alt="Logo" />
          <span className="self-center font-light text-2xl text-[#C400A7]">
            StudyFlow<span className="font-semibold">Modeler</span>
          </span>
          </a>
          </div>
        <div className="flex flex-wrap float-end h-full items-center">
          <a href="/docs" className="flex p-2 text-gray-600 hover:text-gray-900">Docs</a>
          <span className="text-gray-300">&bull;</span>
          <a href="https://github.com/behaverse/studyflow-modeler" className="flex p-2 text-gray-600 hover:text-gray-900">GitHub</a>
          <span className="text-gray-300">&bull;</span>
          <a href="/about/" className="flex p-2 pr-4 text-gray-600 hover:text-gray-900">About</a>    
        </div>
      </nav>
  
      {/* the modeler */}
      <div className="w-full h-full">
        <Modeler />
      </div>
      </div>
    </APIKeyContext.Provider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
