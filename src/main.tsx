import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { ThemeProvider } from './context/ThemeContext'
import { installChunkReloadHandler } from './lib/chunkReload'

// After a deploy, an open tab still runs the old build: reload into the new one instead of crashing
installChunkReloadHandler()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
