import { useEffect, useState } from 'react'
import type { DirectoryListing, FileEntry } from '../../main/files/browser'

/**
 * A lazily-expanding tree — one `files:list` IPC call per directory, only
 * once it's actually clicked open, never a recursive full-project dump.
 * Mirrors VS Code/Finder's own interaction model, which is the whole point
 * of pillar 5 ("without requiring the user to understand the underlying
 * file tree as a developer would").
 */
export function FileTree({
  projectId,
  selectedPath,
  onSelectFile,
}: {
  projectId: string
  selectedPath: string | null
  onSelectFile: (relativePath: string) => void
}) {
  return (
    <div className="mono" data-testid="files-tree" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <TreeLevel projectId={projectId} relativePath="" depth={0} selectedPath={selectedPath} onSelectFile={onSelectFile} />
    </div>
  )
}

function TreeLevel({
  projectId,
  relativePath,
  depth,
  selectedPath,
  onSelectFile,
}: {
  projectId: string
  relativePath: string
  depth: number
  selectedPath: string | null
  onSelectFile: (relativePath: string) => void
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setListing(null)
    setError(null)
    window.laird.files.list({ projectId, relativePath }).then(
      (result) => {
        if (!cancelled) setListing(result)
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      cancelled = true
    }
  }, [projectId, relativePath])

  if (error) {
    return (
      <div style={{ paddingLeft: depth * 14 + 8, color: 'var(--state-danger)', fontSize: 11.5 }} data-testid="files-tree-error">
        {error}
      </div>
    )
  }
  if (!listing) {
    return (
      <div style={{ paddingLeft: depth * 14 + 8, color: 'var(--muted)' }}>Loading…</div>
    )
  }
  if (listing.entries.length === 0) {
    return (
      <div style={{ paddingLeft: depth * 14 + 8, color: 'var(--muted)', fontStyle: 'italic' }}>Empty.</div>
    )
  }

  return (
    <>
      {listing.entries.map((entry) => (
        <TreeNode
          key={entry.name}
          projectId={projectId}
          parentPath={relativePath}
          entry={entry}
          depth={depth}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
      {listing.truncated && (
        <div style={{ paddingLeft: depth * 14 + 8, color: 'var(--muted)', fontStyle: 'italic', fontSize: 11 }}>
          …more than 2,000 entries, not all shown
        </div>
      )}
    </>
  )
}

function TreeNode({
  projectId,
  parentPath,
  entry,
  depth,
  selectedPath,
  onSelectFile,
}: {
  projectId: string
  parentPath: string
  entry: FileEntry
  depth: number
  selectedPath: string | null
  onSelectFile: (relativePath: string) => void
}) {
  const [open, setOpen] = useState(false)
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name
  const isSelected = selectedPath === relativePath

  if (entry.isDirectory) {
    return (
      <div>
        <div
          onClick={() => setOpen((prev) => !prev)}
          data-testid="files-tree-dir"
          style={{
            paddingLeft: depth * 14 + 8,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderRadius: 6,
          }}
        >
          <span style={{ opacity: 0.55, fontSize: 10, width: 10, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
          <span>{entry.name}</span>
        </div>
        {open && (
          <TreeLevel
            projectId={projectId}
            relativePath={relativePath}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => onSelectFile(relativePath)}
      data-testid="files-tree-file"
      data-path={relativePath}
      style={{
        paddingLeft: depth * 14 + 22,
        cursor: 'pointer',
        padding: '3px 8px',
        borderRadius: 6,
        background: isSelected ? 'rgba(var(--surface-rgb),0.6)' : 'transparent',
        color: isSelected ? 'var(--ink)' : 'var(--ink-2)',
      }}
    >
      {entry.name}
    </div>
  )
}
