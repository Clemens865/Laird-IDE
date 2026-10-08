import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface NavDockItem<T extends string> {
  id: T
  label: string
  icon: ReactNode
  testId: string
}

/**
 * A floating glass-pill nav with a highlight that slides to the active
 * item — the one genuinely portable piece of Workspace-OS's "liquid
 * crystal" `LandscapeDock` (confirmed by reading its own source: its
 * `variant: 'bar'` mode already renders this exact shape with zero WebGL,
 * `useGlass(nav, bar ? null : {...})` — only the frosted-blur look needs
 * the shader, not the pill/icon/sliding-highlight shape itself). Reuses
 * Laird's own existing `.glass` CSS technique for the frosted background,
 * not WebGL — no new rendering dependency.
 *
 * The glow is a visual echo of real, already-present state (the active
 * item's own `.on` class / `aria-selected`), never an independent ambient
 * effect — correctly never marked `data-decorative` (that's reserved for
 * grain/mist, the only two ambient-only layers in this app; the existing
 * e2e suite asserts that count stays exactly 2).
 */
export function NavDock<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: NavDockItem<T>[]
  active: T | null
  onSelect: (id: T) => void
}) {
  const navRef = useRef<HTMLDivElement>(null)
  const [glow, setGlow] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const btn = active ? navRef.current?.querySelector<HTMLElement>(`[data-nav-id="${active}"]`) : null
    setGlow(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : null)
  }, [active])

  return (
    <div ref={navRef} className="nav-dock glass" role="tablist" aria-label="Views" data-testid="nav-dock">
      <span className="nav-dock-glow" aria-hidden style={glow ? { left: glow.left, width: glow.width, opacity: 1 } : { opacity: 0 }} />
      {items.map((item) => (
        <div
          key={item.id}
          data-nav-id={item.id}
          data-testid={item.testId}
          className={`nav-dock-item${active === item.id ? ' on' : ''}`}
          role="tab"
          aria-selected={active === item.id}
          onClick={() => onSelect(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}
