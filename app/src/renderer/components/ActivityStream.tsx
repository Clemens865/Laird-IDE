import type { Turn } from '../../shared/types'
import { TurnBubble } from './TurnBubble'

export function ActivityStream({ turns, projectName }: { turns: Turn[]; projectName: string }) {
  return (
    <div className="stream">
      {turns.map((turn) => (
        <TurnBubble key={turn.id} turn={turn} projectName={projectName} />
      ))}
    </div>
  )
}
