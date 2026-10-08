import { describe, expect, it } from 'vitest'
import { resolveEffectsTier } from './effectsTier'

describe('resolveEffectsTier', () => {
  it('returns "full" with no battery info and no reduced-motion preference', () => {
    expect(resolveEffectsTier(false, null)).toBe('full')
  })

  it('returns "off" whenever prefers-reduced-motion is set, regardless of battery', () => {
    expect(resolveEffectsTier(true, null)).toBe('off')
    expect(resolveEffectsTier(true, { charging: false, percent: 5 })).toBe('off')
    expect(resolveEffectsTier(true, { charging: true, percent: 100 })).toBe('off')
  })

  it('returns "light" when unplugged and at or below the low-battery threshold', () => {
    expect(resolveEffectsTier(false, { charging: false, percent: 20 })).toBe('light')
    expect(resolveEffectsTier(false, { charging: false, percent: 8 })).toBe('light')
  })

  it('returns "full" when on battery but above the low threshold', () => {
    expect(resolveEffectsTier(false, { charging: false, percent: 21 })).toBe('full')
    expect(resolveEffectsTier(false, { charging: false, percent: 90 })).toBe('full')
  })

  it('returns "full" when low but actually charging — the low-battery concern only applies while unplugged', () => {
    expect(resolveEffectsTier(false, { charging: true, percent: 5 })).toBe('full')
  })
})
