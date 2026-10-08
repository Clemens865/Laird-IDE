import type { BatteryState } from '../../main/system/battery'

export type EffectsTier = 'full' | 'light' | 'off'

/** Below this, on battery, heavy effects ease off — a laptop at 90% on battery doesn't need to compromise; this is specifically about running low and unplugged. */
const LOW_BATTERY_PERCENT = 20

/**
 * Workspace-OS's own quality-tiering pattern (`useBackdrop.ts`'s real
 * `auto`/`full`/`light`/`off` resolution from battery state +
 * `prefers-reduced-motion`), applied here to Laird's CSS/SVG glass effects
 * instead of a WebGL frame budget — the design-system NFR doc's own "cap
 * simultaneous heavy visual effects" intent, finally enforced as real
 * runtime logic rather than just a design statement.
 *
 * `prefersReducedMotion` is the strongest, non-negotiable signal — an
 * accessibility setting, never silently overridden by anything else here.
 * Battery state only ever eases effects off when genuinely low AND
 * unplugged; a `null` battery (desktop, or the read failed) is treated as
 * "can't tell" and never used as a reason to degrade the experience.
 */
export function resolveEffectsTier(prefersReducedMotion: boolean, battery: BatteryState | null): EffectsTier {
  if (prefersReducedMotion) return 'off'
  if (battery && !battery.charging && battery.percent <= LOW_BATTERY_PERCENT) return 'light'
  return 'full'
}
