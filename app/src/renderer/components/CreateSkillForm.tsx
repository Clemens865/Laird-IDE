import { useState } from 'react'

/**
 * "Create a new skill" — guided prompts standing in for hand-writing YAML
 * frontmatter + markdown by hand, per docs/prd/technical/skills-and-plugins.md's
 * explicit requirement that this produce a real Claude Code skill file, not
 * a Laird-specific format (see src/main/skills/create.ts, which does the
 * actual writing). Validation errors (bad name, empty description, a
 * duplicate name) come back from the real IPC call and surface inline here,
 * rather than being guessed at client-side.
 */
export function CreateSkillForm({
  onCreate,
  onCancel,
}: {
  onCreate: (opts: { name: string; description: string; body: string }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      await onCreate({ name: name.trim(), description: description.trim(), body })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that skill.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%',
    fontSize: 12.5,
    fontFamily: 'inherit',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '8px 11px',
    background: 'var(--surface-raised)',
    color: 'var(--ink)',
  } as const

  return (
    <div className="row-card" data-testid="create-skill-form" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Name (lowercase, hyphens — e.g. "design-review")</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ship-checklist"
          className="mono"
          style={inputStyle}
          data-testid="create-skill-name"
        />
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>When should Claude use this?</div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Use before marking any task done — walks through the pre-ship checklist."
          style={inputStyle}
          data-testid="create-skill-description"
        />
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Instructions (what Claude should actually do)</div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'1. Run the test suite.\n2. Confirm the build succeeds.\n3. Summarize what changed.'}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
          data-testid="create-skill-body"
        />
      </div>
      {error && (
        <div data-testid="create-skill-error" style={{ fontSize: 11.5, color: 'var(--state-danger)' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <div
          className="btn"
          onClick={submitting ? undefined : handleSubmit}
          data-testid="create-skill-submit"
          style={{ cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? 'Creating…' : 'Create skill'}
        </div>
        <div className="btn" onClick={onCancel} data-testid="create-skill-cancel" style={{ cursor: 'pointer', opacity: 0.7 }}>
          Cancel
        </div>
      </div>
    </div>
  )
}
