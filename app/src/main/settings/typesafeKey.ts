import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Exactly Electron's own `safeStorage` module's shape (OS-keychain-backed
 * encryption) — injected rather than imported directly so this module stays
 * unit-testable under plain `vitest` (no real Electron runtime, same reason
 * `claudeHeadlessTransport.ts` injects `spawnFn` instead of calling
 * `child_process.spawn` directly). `main/index.ts` constructs the real one
 * with Electron's actual `safeStorage`.
 */
export interface SecureStringCodec {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export function defaultTypesafeKeyPath(userDataDir: string): string {
  return join(userDataDir, 'typesafe-key.json')
}

/**
 * The user's own TypeSafe/Jev API key (observability-trust-and-harness.md's
 * harness-mode addition) — a third-party credential, so it's stored
 * encrypted-at-rest via the OS keychain, in its own file separate from
 * `MemoryStore`'s general JSON snapshot, and is never sent back to the
 * renderer once set (only whether a key is configured at all).
 */
export class TypesafeKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly codec: SecureStringCodec,
  ) {}

  isAvailable(): boolean {
    return this.codec.isEncryptionAvailable()
  }

  hasKey(): boolean {
    return existsSync(this.filePath)
  }

  getKey(): string | null {
    if (!existsSync(this.filePath)) return null
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as { encrypted: string }
      return this.codec.decryptString(Buffer.from(raw.encrypted, 'base64'))
    } catch (err) {
      console.error('[typesafeKey] failed to read/decrypt the stored key', err)
      return null
    }
  }

  setKey(plainText: string): void {
    if (!this.codec.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this machine — refusing to store an API key unencrypted.')
    }
    const encrypted = this.codec.encryptString(plainText)
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify({ encrypted: encrypted.toString('base64') }), 'utf8')
  }

  clearKey(): void {
    if (existsSync(this.filePath)) rmSync(this.filePath)
  }
}
