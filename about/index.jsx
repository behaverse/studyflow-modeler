import { createRoot } from 'react-dom/client'
import About from './about.mdx'
import '../app/index.scss'

createRoot(document.getElementById('root')).render(
  <About />
)
