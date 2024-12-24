import BFlowModeler from './BFlowModeler'

function App() {

  return (
    <div className="App flex flex-col h-screen">
  
        {/* top navbar */}
      <nav className="bg-gray-50">
        <div className="flex flex-wrap">
        <a href="https://behaverse.org/bflow" className="flex space-x-1">
          <img src="/logo_purple.png" className="h-16 p-1" alt="BFlow Logo" />
          <span className="self-center text-2xl font-semibold">Behaverse Flow Modeler</span>
        </a>
        </div>
      </nav>
  
      {/* the modeler */}
      <div className="w-full h-full">
        <BFlowModeler />
      </div>
    </div>
  )
}

export default App
