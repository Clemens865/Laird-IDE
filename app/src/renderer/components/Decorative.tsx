import type { ReactNode } from 'react'

/**
 * Marks a purely ambient/illustrative element (mist drift, grain) so it can
 * never be mistaken for real status — the decorative-vs-signal rule from
 * docs/prd/technical/observability-trust-and-harness.md. `aria-hidden`
 * because these elements carry no information a screen reader should ever
 * announce; `data-decorative` is the structural marker a future lint
 * rule / visual-regression check can key off.
 */
export function Decorative({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={className} data-decorative="true" aria-hidden="true">
      {children}
    </div>
  )
}
