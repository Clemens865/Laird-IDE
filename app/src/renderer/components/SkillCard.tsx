import type { Skill } from '../../shared/types'

/**
 * `onToggle` present = a global skill, shown with its per-project opt-in
 * switch (off by default — see docs/prd/technical/skills-and-plugins.md's
 * resolved design). Absent = a project skill, always on, no switch to show.
 */
export function SkillCard({
  skill,
  enabled,
  onToggle,
}: {
  skill: Skill
  enabled?: boolean
  onToggle?: (enabled: boolean) => void
}) {
  return (
    <div className="row-card" data-testid="skill-card" data-skill-id={skill.id}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth={1.8}>
        <path d="M9 11 L12 14 L21 5 M12 2 C6.5 2 2 6.5 2 12 C2 17.5 6.5 22 12 22 C17.5 22 22 17.5 22 12" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{skill.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {skill.description}
        </div>
      </div>
      {skill.source === 'plugin' && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
          plugin
        </span>
      )}
      {onToggle ? (
        <label className="skill-toggle" data-testid="skill-toggle">
          <input
            type="checkbox"
            checked={enabled ?? false}
            onChange={(e) => onToggle(e.target.checked)}
            data-testid="skill-toggle-input"
          />
          <span className="skill-toggle-track" />
        </label>
      ) : (
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--codex)' }}>
          on
        </span>
      )}
    </div>
  )
}
