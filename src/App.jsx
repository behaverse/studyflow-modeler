import './App.css'
import BFlowModeler from './BFlowModeler'

function App() {

  return (
    <>
      <div>
        <a href="https://behaverse.org/bflow" target="_blank">
          <img src="/logo_purple.png" className="logo" alt="BFlow logo" />
        </a>
      </div>
      <h1>BFlow Modeler</h1>
      <div>
      <BFlowModeler />
      </div>
    </>
  )
}

export default App
