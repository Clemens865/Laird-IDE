export interface SessionTransportEvent {
  kind: 'text' | 'tool-call' | 'file-change' | 'usage' | 'session-id' | 'error' | 'subagent'
  payload: unknown
  turnId?: string
}

export interface SessionTransportStartOptions {
  cwd: string
  prompt: string
  resumeId?: string
  model?: string
}

export interface SessionTransportExitInfo {
  code: number | null
  failure?: { kind: string; message: string }
}

/** The seam between "how Laird talks to an agent CLI" and everything above it. */
export interface SessionTransport {
  start(opts: SessionTransportStartOptions): void
  send(prompt: string): void
  cancel(): void
  stop(): void
  onEvent(cb: (e: SessionTransportEvent) => void): void
  onExit(cb: (info: SessionTransportExitInfo) => void): void
}
