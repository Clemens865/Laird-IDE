import { useEffect, useRef, useState } from 'react'
import type { Project } from '../../shared/types'

type Status = 'idle' | 'starting' | 'active' | 'error'

/**
 * One real, embedded, live-interactive `WebContentsView` panel
 * (`src/main/harness/previewPanel.ts`) — the same real page the user
 * watches here is the exact surface the harness's own Playwright MCP
 * server later drives over CDP, not a second, invisible browser
 * (observability-trust-and-harness.md, user-directed follow-up,
 * 2026-10-07). This component only owns the placeholder's real screen
 * position; the actual pixels come from the native view main draws exactly
 * over it.
 */
export function LivePreviewPanel({ project }: { project: Project }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || status !== 'active') return

    const sync = () => {
      const rect = el.getBoundingClientRect()
      window.laird.previewPanel.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [status])

  useEffect(() => {
    // Hides (not stops) on unmount — switching views shouldn't kill a real,
    // possibly harness-shared dev server just because this panel scrolled
    // out of the component tree.
    return () => {
      window.laird.previewPanel.hide()
    }
  }, [])

  async function handleStart() {
    setStatus('starting')
    setError(null)
    const result = await window.laird.previewPanel.start({ projectId: project.id })
    if (result.ok) {
      setStatus('active')
    } else {
      setStatus('error')
      setError(result.message)
    }
  }

  async function handleStop() {
    await window.laird.previewPanel.stop()
    setStatus('idle')
  }

  if (!project.uiPreview) {
    return (
      <div className="skills-section-empty" data-testid="live-preview-not-configured">
        Configure a UI preview command above to enable the live preview.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {status === 'active' ? (
          <div className="btn" onClick={handleStop} data-testid="live-preview-stop" style={{ cursor: 'pointer' }}>
            Stop live preview
          </div>
        ) : (
          <div
            className="btn"
            onClick={status === 'starting' ? undefined : handleStart}
            data-testid="live-preview-start"
            style={{ cursor: status === 'starting' ? 'default' : 'pointer', opacity: status === 'starting' ? 0.6 : 1 }}
          >
            {status === 'starting' ? 'Starting…' : 'Start live preview'}
          </div>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 11.5, color: 'var(--state-danger)' }} data-testid="live-preview-error">
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        data-testid="live-preview-surface"
        style={{
          width: '100%',
          height: 420,
          borderRadius: 10,
          border: '1px solid var(--line)',
          background: status === 'active' ? 'transparent' : 'var(--surface-raised)',
          display: status === 'active' ? 'block' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {status !== 'active' && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {status === 'starting' ? 'Starting the real dev server…' : 'Not running'}
          </span>
        )}
      </div>
    </div>
  )
}
