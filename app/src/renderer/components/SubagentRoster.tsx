import type { Subagent } from '../../shared/types'
import { ACCENT_PALETTE } from '../../shared/theme'

/**
 * Live subagent status, ported from v9-signature's own "Agent activity"
 * sidebar rows (design/variations/v9-signature/index.html) — `.row-card`/
 * `.glyph`/`.r-title`/`.r-sub`/`.pulse` are its real classes, not invented
 * here. Driven by real `task_*` system events from the `claude` CLI (see
 * mapEvents.ts and sessionManager.ts), confirmed live in a Workstream C
 * chunk-4 spike that actually spawned a subagent via the `Agent` tool.
 *
 * Renders nothing when a session hasn't spawned any subagent — Foundation
 * and most everyday turns never do, and an empty "Agent activity" panel
 * would just be chrome with nothing to say.
 */
function glyphColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return ACCENT_PALETTE[hash % ACCENT_PALETTE.length]
}

export function SubagentRoster({ subagents }: { subagents: Subagent[] }) {
  if (subagents.length === 0) return null

  return (
    <div className="sidebar glass" style={{ width: 240, flexShrink: 0 }} data-testid="subagent-roster">
      <div>
        <div className="label">Agent activity</div>
        {subagents.map((subagent) => (
          <div className="row-card" key={subagent.id} data-testid="subagent-row" data-subagent-status={subagent.status}>
            <div className="glyph" style={{ background: glyphColor(subagent.id) }}>
              {subagent.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="r-title">{subagent.name}</div>
              <div className="r-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {subagent.status === 'done' ? `done · ${subagent.lastAction ?? 'no result'}` : subagent.lastAction ?? subagent.role}
              </div>
            </div>
            {subagent.status === 'done' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--codex)" strokeWidth={2.4}>
                <path d="M20 6 L9 17 L4 12" />
              </svg>
            ) : (
              <span className="pulse" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
