import { useEffect, useState } from 'react'
import { resolveEffectsTier, type EffectsTier } from './effectsTier'

/** Battery state changes slowly — a cheap periodic re-check, not a push subscription, matches how little it actually needs to react. */
const BATTERY_RECHECK_MS = 60_000

/**
 * Mounted once, machine-wide (`App.tsx`), writes `data-effects` onto
 * `<html>` so `tokens.css`'s `[data-effects="light"|"off"]` rules can
 * reach every `.glass`/`.grain`/`.mist-blob` regardless of DOM depth.
 * Re-resolves live on two real signals: the OS `prefers-reduced-motion`
 * setting changing while the app is open, and the periodic battery
 * re-check — never a one-shot decision made only at launch.
 */
export function useEffectsTier(): EffectsTier {
  const [tier, setTier] = useState<EffectsTier>('full')

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let cancelled = false

    async function recompute() {
      const battery = await window.laird.system.getBattery()
      if (cancelled) return
      setTier(resolveEffectsTier(motionQuery.matches, battery))
    }

    void recompute()
    motionQuery.addEventListener('change', recompute)
    const interval = setInterval(recompute, BATTERY_RECHECK_MS)

    return () => {
      cancelled = true
      motionQuery.removeEventListener('change', recompute)
      clearInterval(interval)
    }
  }, [])

  return tier
}
