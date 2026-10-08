import { describe, expect, it, vi } from 'vitest'
import { getBatteryState } from './battery'

describe('getBatteryState', () => {
  it('returns real charging/percent when a battery exists', async () => {
    const batteryFn = vi.fn().mockResolvedValue({ hasBattery: true, isCharging: false, percent: 8 })
    const state = await getBatteryState(batteryFn as never)
    expect(state).toEqual({ charging: false, percent: 8 })
  })

  it('returns null when the machine has no battery at all (a desktop)', async () => {
    const batteryFn = vi.fn().mockResolvedValue({ hasBattery: false, isCharging: false, percent: 0 })
    const state = await getBatteryState(batteryFn as never)
    expect(state).toBeNull()
  })

  it('fails open to null when the real call throws, never crashing the caller', async () => {
    const batteryFn = vi.fn().mockRejectedValue(new Error('no such OS API on this platform'))
    const state = await getBatteryState(batteryFn as never)
    expect(state).toBeNull()
  })
})
