import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

const splash = document.getElementById('boot-splash')
createRoot(document.getElementById('root')!).render(<App />)
splash?.classList.add('boot-splash--hide')
window.setTimeout(() => splash?.remove(), 200)
