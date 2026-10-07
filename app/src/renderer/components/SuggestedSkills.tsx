import { useState } from 'react'
import type { Skill } from '../../shared/types'

/**
 * Workstream C chunk 5: "auto-recommend skills/subagents on first run from a
 * quick repo read" (docs/prd/technical/skills-and-plugins.md) — explicitly
 * an editable, dismissible PROPOSAL, never an auto-install. `signals` is the
 * plain stack tags a cheap, non-LLM file scan found (see
 * src/main/skills/recommend.ts); `recommended` is already-discovered real
 * global skills whose own name/description matched one of them.
 */
export function SuggestedSkills({
  signals,
  recommended,
  onApply,
  onDismiss,
}: {
  signals: string[]
  recommended: Skill[]
  onApply: (selectedIds: string[]) => void
  onDismiss: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(recommended.map((s) => s.id)))

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="skills-section" data-testid="suggested-skills">
      <div className="label">
        Suggested for this project{signals.length > 0 ? ` — detected ${signals.join(', ')}` : ''}
      </div>
      {recommended.map((skill) => (
        <div className="row-card" key={skill.id} data-testid="suggested-skill-row" data-skill-id={skill.id}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selected.has(skill.id)}
              onChange={(e) => toggle(skill.id, e.target.checked)}
              data-testid="suggested-skill-checkbox"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{skill.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {skill.description}
              </div>
            </div>
          </label>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <div className="btn" onClick={() => onApply([...selected])} data-testid="suggested-skills-apply" style={{ cursor: 'pointer' }}>
          Turn on selected
        </div>
        <div className="btn" onClick={onDismiss} data-testid="suggested-skills-dismiss" style={{ cursor: 'pointer', opacity: 0.7 }}>
          Not now
        </div>
      </div>
    </div>
  )
}
