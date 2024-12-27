import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import StudyFlowModeler from './StudyFlowModeler'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './index.css'


function App() {

  return (
    <div className="App flex flex-col h-screen">
  
        {/* top navbar */}
      <nav className="bg-gray-50">
        <div className="flex flex-wrap">
        <a href="/" className="flex space-x-1">
          <img src="/logo_purple.png" className="h-16 p-1" alt="StudyFlow Logo" />
          <span className="self-center text-2xl">
            Behaverse StudyFlow
            <span className="font-semibold"> Modeler</span>
          </span>
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
