import { describe, expect, it, vi } from 'vitest'
import { wireAutoUpdater, type AutoUpdaterLike, type UpdateEvent } from './autoUpdater'

/** A real, harmless fake updater — no network, no real electron-updater internals — mirroring just the shape `wireAutoUpdater` depends on. */
function makeFakeUpdater(): AutoUpdaterLike & { emit: (event: string, ...args: unknown[]) => void } {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    autoDownload: true,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on(event, cb) {
      const list = listeners.get(event) ?? []
      list.push(cb)
      listeners.set(event, list)
    },
    emit(event, ...args) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
    },
  }
}

describe('wireAutoUpdater', () => {
  it('forces autoDownload to false — the UI decides when a download starts, never the library', () => {
    const updater = makeFakeUpdater()
    wireAutoUpdater(updater, () => {})
    expect(updater.autoDownload).toBe(false)
  })

  it('maps checking-for-update to a checking event', () => {
    const updater = makeFakeUpdater()
    const events: UpdateEvent[] = []
    wireAutoUpdater(updater, (e) => events.push(e))
    updater.emit('checking-for-update')
    expect(events).toEqual([{ kind: 'checking' }])
  })

  it('maps update-available to an available event carrying the real version', () => {
    const updater = makeFakeUpdater()
    const events: UpdateEvent[] = []
    wireAutoUpdater(updater, (e) => events.push(e))
    updater.emit('update-available', { version: '0.2.0' })
    expect(events).toEqual([{ kind: 'available', version: '0.2.0' }])
  })

  it('maps update-not-available to a not-available event', () => {
    const updater = makeFakeUpdater()
    const events: UpdateEvent[] = []
    wireAutoUpdater(updater, (e) => events.push(e))
    updater.emit('update-not-available')
    expect(events).toEqual([{ kind: 'not-available' }])
  })

  it('maps a real Error to an error event with its message', () => {
    const updater = makeFakeUpdater()
    const events: UpdateEvent[] = []
    wireAutoUpdater(updater, (e) => events.push(e))
    updater.emit('error', new Error('network unreachable'))
    expect(events).toEqual([{ kind: 'error', message: 'network unreachable' }])
  })

  it('maps download-progress to a rounded percent', () => {
    const updater = makeFakeUpdater()
    const events: UpdateEvent[] = []
    wireAutoUpdater(updater, (e) => events.push(e))
    updater.emit('download-progress', { percent: 42.7 })
    expect(events).toEqual([{ kind: 'progress', percent: 43 }])
  })

  it('maps update-downloaded to a downloaded event carrying the real version', () => {
    const updater = makeFakeUpdater()
    const events: UpdateEvent[] = []
    wireAutoUpdater(updater, (e) => events.push(e))
    updater.emit('update-downloaded', { version: '0.2.0' })
    expect(events).toEqual([{ kind: 'downloaded', version: '0.2.0' }])
  })

  it('falls back to "unknown" when a version-carrying event has no usable version field', () => {
    const updater = makeFakeUpdater()
    const events: UpdateEvent[] = []
    wireAutoUpdater(updater, (e) => events.push(e))
    updater.emit('update-available', {})
    expect(events).toEqual([{ kind: 'available', version: 'unknown' }])
  })
})
