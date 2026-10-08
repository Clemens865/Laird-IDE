import { useEffect, useState } from 'react'
import { FilePreview } from './FilePreview'
import { FileTree } from './FileTree'

/** Finder-style file/document access (product pillar 5) — read-only preview + "Open in default app", scoped to `project.path`. See `src/main/files/`. */
export function FilesView({ projectId }: { projectId: string }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    setSelectedPath(null)
  }, [projectId])

  return (
    <div className="body" data-testid="files-view">
      <div
        className="glass"
        style={{ width: 300, flexShrink: 0, padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}
      >
        <div className="label">Project files</div>
        <FileTree projectId={projectId} selectedPath={selectedPath} onSelectFile={setSelectedPath} />
      </div>
      <div className="glass" style={{ flex: 1, minWidth: 0, padding: '18px 22px', overflowY: 'auto' }}>
        <FilePreview projectId={projectId} relativePath={selectedPath} />
      </div>
    </div>
  )
}
