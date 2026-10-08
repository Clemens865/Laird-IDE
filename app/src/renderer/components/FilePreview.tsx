import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { FilePreview as FilePreviewData } from '../../main/files/browser'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Read-only preview + "Open in default app" (`shell.openPath`, via
 * `FILES_OPEN_EXTERNAL`) — the real v1 editing path, per the product
 * decision that Laird previews files but doesn't re-implement a code
 * editor (the agent is the one that writes code). The open button is
 * always present, not just a fallback for the unpreviewable case.
 */
export function FilePreview({ projectId, relativePath }: { projectId: string; relativePath: string | null }) {
  const [preview, setPreview] = useState<FilePreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openStatus, setOpenStatus] = useState<{ ok: boolean; message?: string } | null>(null)

  useEffect(() => {
    setOpenStatus(null)
    setPreview(null)
    setError(null)
    if (!relativePath) return
    let cancelled = false
    setLoading(true)
    window.laird.files.read({ projectId, relativePath }).then(
      (result) => {
        if (!cancelled) {
          setPreview(result)
          setLoading(false)
        }
      },
      (err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [projectId, relativePath])

  async function handleOpenExternal() {
    if (!relativePath) return
    const result = await window.laird.files.openExternal({ projectId, relativePath })
    setOpenStatus(result)
  }

  if (!relativePath) {
    return (
      <div className="skills-section-empty" data-testid="files-preview-empty">
        Select a file to preview it.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="files-preview">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', wordBreak: 'break-all' }}>
          {relativePath}
        </span>
        <div className="btn" onClick={handleOpenExternal} data-testid="files-open-external" style={{ cursor: 'pointer', flexShrink: 0 }}>
          Open in default app
        </div>
      </div>
      {openStatus && !openStatus.ok && (
        <div data-testid="files-open-external-error" style={{ fontSize: 11.5, color: 'var(--state-danger)' }}>
          {openStatus.message}
        </div>
      )}
      {loading ? (
        <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
          Loading…
        </span>
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--state-danger)' }}>{error}</div>
      ) : preview ? (
        <PreviewBody preview={preview} />
      ) : null}
    </div>
  )
}

function PreviewBody({ preview }: { preview: FilePreviewData }) {
  if (preview.kind === 'too-large') {
    return (
      <div className="skills-section-empty" data-testid="files-preview-too-large">
        This file is too large to preview here ({formatBytes(preview.sizeBytes)}) — use "Open in default app" instead.
      </div>
    )
  }
  if (preview.kind === 'binary') {
    return (
      <div className="skills-section-empty" data-testid="files-preview-binary">
        Can't preview this file type — use "Open in default app" instead.
      </div>
    )
  }
  if (preview.kind === 'image') {
    // `alignSelf: 'flex-start'` matters more than it looks — without it, a
    // flex child (the parent column is a flex container) stretches to fill
    // the cross-axis width by default, and a small image (e.g. a 1x1 or
    // 16x16 icon) with `height: auto` then scales its height to match that
    // stretched width via its own intrinsic aspect ratio — blowing a tiny
    // icon up into a huge square. Caught only by a real screenshot, not a
    // DOM-structural check (the `<img>`'s `src` was already correct).
    return (
      <img
        src={preview.content}
        alt="File preview"
        data-testid="files-preview-image"
        style={{ maxWidth: '100%', maxHeight: '70vh', width: 'auto', height: 'auto', borderRadius: 10, display: 'block', alignSelf: 'flex-start' }}
      />
    )
  }
  if (preview.kind === 'markdown') {
    return (
      <div className="files-markdown-preview" data-testid="files-preview-markdown" style={{ fontSize: 13, lineHeight: 1.6 }}>
        <ReactMarkdown>{preview.content}</ReactMarkdown>
      </div>
    )
  }
  return (
    <pre
      className="mono"
      data-testid="files-preview-text"
      style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}
    >
      {preview.content}
    </pre>
  )
}
