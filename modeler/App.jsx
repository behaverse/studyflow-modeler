import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import StudyFlowModeler from './StudyFlowModeler'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './index.css'
import logo_image from './assets/behaverse_logo.png'

function App() {

  return (
    <div className="App flex flex-col h-screen">
  
        {/* top navbar */}
      <nav className="bg-gray-50">
        <div className="flex flex-wrap">
        <a href="/" className="flex space-x-2">
          <img src={logo_image} className="h-16 p-1" alt="Logo" />
          <span className="self-center text-2xl text-fuchsia-900">
            StudyFlow
          </span>
          <span className="self-center text-2xl font-bold rounded text-fuchsia-900"> Modeler</span>
        </a>
        </div>
      </nav>
  
      {/* the modeler */}
      <div className="w-full h-full">
        <StudyFlowModeler />
      </div>
    </div>
  )
}

export default App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
