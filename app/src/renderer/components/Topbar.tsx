import { BoardFlip } from './BoardFlip'
import { NavDock, type NavDockItem } from './NavDock'
import { ThemeToggle } from './ThemeToggle'
import { FilesIcon, GridIcon, HarnessIcon, HistoryIcon, MarketplaceIcon, SkillsIcon } from './navIcons'

export type AppView = 'tabs' | 'grid' | 'skills' | 'history' | 'marketplace' | 'harness' | 'files'

const NAV_ITEMS: NavDockItem<AppView>[] = [
  { id: 'history', label: 'History', icon: <HistoryIcon />, testId: 'toggle-history-button' },
  { id: 'skills', label: 'Skills & agents', icon: <SkillsIcon />, testId: 'toggle-skills-button' },
  { id: 'marketplace', label: 'Marketplace', icon: <MarketplaceIcon />, testId: 'toggle-marketplace-button' },
  { id: 'harness', label: 'Harness', icon: <HarnessIcon />, testId: 'toggle-harness-button' },
  { id: 'files', label: 'Files', icon: <FilesIcon />, testId: 'toggle-files-button' },
  { id: 'grid', label: 'Grid view', icon: <GridIcon />, testId: 'toggle-view-button' },
]

export function Topbar({ view, onSetView }: { view: AppView; onSetView: (view: AppView) => void }) {
  return (
    <div className="topbar glass" style={{ borderRadius: 0 }}>
      <div className="brand">
        <BoardFlip />
        Laird<span className="sub">&nbsp;· workspace</span>
      </div>
      <NavDock
        items={NAV_ITEMS}
        active={view === 'tabs' ? null : view}
        onSelect={(id) => onSetView(view === id ? 'tabs' : id)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ThemeToggle />
        <div className="avatar" style={{ background: 'var(--amber-soft)' }}>
          CH
        </div>
      </div>
    </div>
  )
}
