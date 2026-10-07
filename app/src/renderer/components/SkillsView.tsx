import { useEffect, useState } from 'react'
import type { Skill, SubagentDefinition } from '../../shared/types'
import { CreateSkillForm } from './CreateSkillForm'
import { SkillCard } from './SkillCard'
import { SuggestedSkills } from './SuggestedSkills'

interface SkillsState {
  projectSkills: Skill[]
  globalSkills: Skill[]
  projectAgents: SubagentDefinition[]
  globalAgents: SubagentDefinition[]
  enabledGlobalSkillIds: string[]
}

interface RecommendState {
  isFirstRun: boolean
  signals: string[]
  recommended: Skill[]
}

const EMPTY: SkillsState = { projectSkills: [], globalSkills: [], projectAgents: [], globalAgents: [], enabledGlobalSkillIds: [] }

export function SkillsView({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SkillsState>(EMPTY)
  const [recommend, setRecommend] = useState<RecommendState | null>(null)
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSuggestionDismissed(false)
    Promise.all([window.laird.skills.list({ projectId }), window.laird.skills.recommend({ projectId })]).then(
      ([listResult, recommendResult]) => {
        if (!cancelled) {
          setState(listResult)
          setRecommend(recommendResult)
          setLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function handleToggle(skillId: string, enabled: boolean) {
    // Optimistic — the whole point of this list is instant, visible control.
    setState((prev) => ({
      ...prev,
      enabledGlobalSkillIds: enabled
        ? [...prev.enabledGlobalSkillIds, skillId]
        : prev.enabledGlobalSkillIds.filter((id) => id !== skillId),
    }))
    await window.laird.skills.setEnabled({ projectId, skillId, enabled })
  }

  async function handleApplySuggestions(selectedIds: string[]) {
    setState((prev) => ({ ...prev, enabledGlobalSkillIds: [...new Set([...prev.enabledGlobalSkillIds, ...selectedIds])] }))
    setSuggestionDismissed(true)
    await Promise.all(selectedIds.map((skillId) => window.laird.skills.setEnabled({ projectId, skillId, enabled: true })))
  }

  async function handleCreateSkill(opts: { name: string; description: string; body: string }) {
    // Errors (bad name, empty description, duplicate) propagate to the form's own inline error — not caught here.
    const skill = await window.laird.skills.create({ projectId, ...opts })
    setState((prev) => ({ ...prev, projectSkills: [...prev.projectSkills, skill] }))
    setCreating(false)
  }

  if (loading) {
    return (
      <div className="skills-view" data-testid="skills-view">
        <span className="mono" style={{ color: 'var(--muted)' }}>
          Loading…
        </span>
      </div>
    )
  }

  const showSuggestions = !suggestionDismissed && recommend?.isFirstRun && recommend.recommended.length > 0

  return (
    <div className="skills-view" data-testid="skills-view">
      {showSuggestions && recommend && (
        <SuggestedSkills
          signals={recommend.signals}
          recommended={recommend.recommended}
          onApply={handleApplySuggestions}
          onDismiss={() => setSuggestionDismissed(true)}
        />
      )}

      <div className="skills-section">
        <div className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          This project's skills
          {!creating && (
            <span
              className="mono"
              onClick={() => setCreating(true)}
              data-testid="new-skill-button"
              style={{ fontSize: 11.5, color: 'var(--codex)', cursor: 'pointer', fontStyle: 'normal', fontWeight: 600 }}
            >
              + New skill
            </span>
          )}
        </div>
        {creating && <CreateSkillForm onCreate={handleCreateSkill} onCancel={() => setCreating(false)} />}
        {state.projectSkills.length === 0 ? (
          !creating && <div className="skills-section-empty">No project-scoped skills yet — create one, or turn on one available below.</div>
        ) : (
          state.projectSkills.map((skill) => <SkillCard key={skill.id} skill={skill} />)
        )}
      </div>

      <div className="skills-section">
        <div className="label">Also available on this machine</div>
        {state.globalSkills.length === 0 ? (
          <div className="skills-section-empty">Nothing else installed globally.</div>
        ) : (
          state.globalSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              enabled={state.enabledGlobalSkillIds.includes(skill.id)}
              onToggle={(enabled) => handleToggle(skill.id, enabled)}
            />
          ))
        )}
      </div>

      <div className="skills-section">
        <div className="label">Subagents</div>
        {state.projectAgents.length === 0 && state.globalAgents.length === 0 ? (
          <div className="skills-section-empty">No custom subagents defined.</div>
        ) : (
          <>
            {state.projectAgents.map((agent) => (
              <div key={agent.id} className="row-card" data-testid="subagent-card">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{agent.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{agent.description}</div>
                </div>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--codex)' }}>
                  project
                </span>
              </div>
            ))}
            {state.globalAgents.map((agent) => (
              <div key={agent.id} className="row-card" data-testid="subagent-card" style={{ opacity: 0.7 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{agent.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{agent.description}</div>
                </div>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                  global
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
