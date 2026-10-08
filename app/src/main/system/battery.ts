import { battery as siBattery } from 'systeminformation'

export interface BatteryState {
  charging: boolean
  percent: number
}

/**
 * Real, cross-platform battery state (Workspace-OS's own quality-tiering
 * pattern, confirmed live in its `useBackdrop.ts`) — `systeminformation` is
 * the standard pick here because the renderer-side web `navigator.
 * getBattery()` API is confirmed absent in this Electron version (verified
 * live, not assumed: `typeof navigator.getBattery` is `undefined`).
 *
 * Fails open to `null` on any error or when there's no real battery at all
 * (a desktop) — the renderer treats `null` as "can't tell, assume full
 * power," never as a reason to degrade the experience.
 */
export async function getBatteryState(batteryFn: typeof siBattery = siBattery): Promise<BatteryState | null> {
  try {
    const info = await batteryFn()
    if (!info.hasBattery) return null
    return { charging: info.isCharging, percent: info.percent }
  } catch (err) {
    console.error('[battery] failed to read battery state, failing open', err)
    return null
  }
}
