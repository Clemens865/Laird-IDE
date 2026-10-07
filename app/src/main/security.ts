import type { IpcMainInvokeEvent } from 'electron'

/** Rejects IPC from any non-top-level frame (e.g. a compromised webview). Ported from Workspace-OS. */
export function assertMainFrame(event: IpcMainInvokeEvent): void {
  if (event.senderFrame?.parent) {
    throw new Error('IPC rejected: sender is not the main frame')
  }
}
