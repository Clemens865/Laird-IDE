import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/newsreader/500.css'
import '@fontsource/newsreader/600.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import './theme/tokens.css'
import './theme/v9.css'
import './theme/midnight.css'
import { App } from './App'

// A real, persisted per-viewer preference — restored before first paint so
// there's no flash of the wrong theme. The proof that Workstream F's token
// contract actually decouples visuals from logic: this is the only
// theme-switching code in the whole app, and it never touches a component.
try {
  const saved = localStorage.getItem('laird-theme')
  if (saved === 'midnight') document.documentElement.dataset.theme = 'midnight'
} catch {
  // Private window / blocked storage — falls back to the default theme, never breaks the app.
}

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
