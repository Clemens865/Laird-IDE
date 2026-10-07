import { ipcMain, type IpcMainInvokeEvent } from 'electron'

type CleanupFn = () => void | Promise<void>
const cleanups = new Map<string, CleanupFn>()

/** Registers a handler run on app quit (closing PTYs/child processes, etc.). */
export function registerCleanup(name: string, fn: CleanupFn): void {
  cleanups.set(name, fn)
}

export async function runCleanups(): Promise<void> {
  for (const [name, fn] of cleanups) {
    try {
      await fn()
    } catch (err) {
      console.error(`[cleanup:${name}] failed`, err)
    }
  }
}

/** Thin wrapper around ipcMain.handle centralizing error handling. */
export function ipcHandle<Args extends unknown[], Result>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as Args))
    } catch (err) {
      console.error(`[ipc:${channel}] handler failed`, err)
      throw err
    }
  })
}
