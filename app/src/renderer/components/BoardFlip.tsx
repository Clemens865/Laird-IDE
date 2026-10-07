import type { CSSProperties } from 'react'

/**
 * The surfboard flip — identity (color) and activation state (idle/running)
 * are the same object, per the locked v9-signature design. The brand mark's
 * continuous idle animation is applied by CSS via the `.brand` ancestor
 * selector (`.brand .board-flip-inner`), not by a prop here — nest this
 * inside an element with class "brand" for that variant, nothing else to do.
 */
export function BoardFlip({ active = false, color }: { active?: boolean; color?: string }) {
  const style = color ? ({ '--tc': color } as CSSProperties) : undefined
  return (
    <div className={`board-flip${active ? ' active' : ''}`} style={style}>
      <div className="board-flip-inner">
        <svg className="face face-side" viewBox="0 0 1200 420">
          <use href="#board-side" />
        </svg>
        <svg className="face face-top" viewBox="0 0 1200 420">
          <use href="#board-top" />
        </svg>
      </div>
    </div>
  )
}
