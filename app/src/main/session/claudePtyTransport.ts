import type {
  SessionTransport,
  SessionTransportEvent,
  SessionTransportExitInfo,
  SessionTransportStartOptions,
} from './transport'

/**
 * Escape-hatch transport stub (Foundation scope: interface only, proves the
 * seam is real without spending Foundation's budget on it). Real
 * implementation, when needed, is a trimmed port of Workspace-OS's
 * `agent-pty.ts` (node-pty, Map<sessionId, PtySession>, HITL permission-
 * prompt detection) — not built here.
 */
export class ClaudePtyTransport implements SessionTransport {
  start(_opts: SessionTransportStartOptions): void {
    throw new Error('ClaudePtyTransport is not implemented in Foundation — see Workstream A chunk notes')
  }
  send(_prompt: string): void {
    throw new Error('not implemented in Foundation')
  }
  cancel(): void {
    throw new Error('not implemented in Foundation')
  }
  stop(): void {
    throw new Error('not implemented in Foundation')
  }
  onEvent(_cb: (e: SessionTransportEvent) => void): void {
    throw new Error('not implemented in Foundation')
  }
  onExit(_cb: (info: SessionTransportExitInfo) => void): void {
    throw new Error('not implemented in Foundation')
  }
}
