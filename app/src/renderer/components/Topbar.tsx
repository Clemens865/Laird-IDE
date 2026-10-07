import { BoardFlip } from './BoardFlip'
import { ThemeToggle } from './ThemeToggle'

export type AppView = 'tabs' | 'grid' | 'skills' | 'history' | 'marketplace'

export function Topbar({ view, onSetView }: { view: AppView; onSetView: (view: AppView) => void }) {
  return (
    <div className="topbar glass" style={{ borderRadius: 0 }}>
      <div className="brand">
        <BoardFlip />
        Laird<span className="sub">&nbsp;· workspace</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          className="btn"
          onClick={() => onSetView(view === 'history' ? 'tabs' : 'history')}
          data-testid="toggle-history-button"
          style={{ cursor: 'pointer' }}
        >
          History
        </div>
        <div
          className="btn"
          onClick={() => onSetView(view === 'skills' ? 'tabs' : 'skills')}
          data-testid="toggle-skills-button"
          style={{ cursor: 'pointer' }}
        >
          Skills &amp; agents
        </div>
        <div
          className="btn"
          onClick={() => onSetView(view === 'marketplace' ? 'tabs' : 'marketplace')}
          data-testid="toggle-marketplace-button"
          style={{ cursor: 'pointer' }}
        >
          Marketplace
        </div>
        <div
          className="btn"
          onClick={() => onSetView(view === 'grid' ? 'tabs' : 'grid')}
          data-testid="toggle-view-button"
          style={{ cursor: 'pointer' }}
        >
          {view === 'grid' ? 'Tab view' : 'Grid view'}
        </div>
        <ThemeToggle />
        <div className="avatar" style={{ background: 'var(--amber-soft)' }}>
          CH
        </div>
      </div>
    </div>
  )
}
