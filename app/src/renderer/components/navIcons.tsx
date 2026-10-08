/**
 * Small, hand-drawn stroke icons for `NavDock` — matching this app's own
 * existing icon style throughout (2px stroke, round caps/joins, no icon
 * library dependency; see e.g. the add-project/folder-picker/checkmark
 * icons in `App.tsx`), not Workspace-OS's `lucide-react` set.
 */
const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function HistoryIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7 V12 L16 14" />
    </svg>
  )
}

export function SkillsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3 L13.5 9.5 L20 11 L13.5 12.5 L12 19 L10.5 12.5 L4 11 L10.5 9.5 Z" />
    </svg>
  )
}

export function MarketplaceIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 8 H18 L17 20 H7 Z" />
      <path d="M9 8 V6 a3 3 0 0 1 6 0 V8" />
    </svg>
  )
}

export function HarnessIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3 L19 6 V11 C19 16 16 19.5 12 21 C8 19.5 5 16 5 11 V6 Z" />
      <path d="M9 12 L11 14 L15.5 9.5" />
    </svg>
  )
}

/** Same real path as the "Browse…" folder-picker button (`App.tsx`) — one folder glyph, used consistently everywhere it means "a real directory." */
export function FilesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

export function GridIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}
