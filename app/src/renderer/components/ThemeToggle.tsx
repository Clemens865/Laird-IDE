import { useState } from 'react'

function readInitialTheme(): 'default' | 'midnight' {
  return document.documentElement.dataset.theme === 'midnight' ? 'midnight' : 'default'
}

/**
 * The concrete proof Workstream F's own plan required: "at minimum, one
 * second theme... switches cleanly with no component code changes." This
 * component is the only place that ever sets `data-theme` — every visual
 * change it causes comes from midnight.css's token overrides, not from
 * this component branching on theme itself.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'default' | 'midnight'>(readInitialTheme)

  function toggle() {
    const next = theme === 'midnight' ? 'default' : 'midnight'
    setTheme(next)
    if (next === 'default') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('laird-theme', next)
    } catch {
      // Private window / blocked storage — the toggle still works for this session, just doesn't persist.
    }
  }

  return (
    <div className="btn" onClick={toggle} data-testid="theme-toggle-button" style={{ cursor: 'pointer' }}>
      {theme === 'midnight' ? 'Light theme' : 'Dark theme'}
    </div>
  )
}
