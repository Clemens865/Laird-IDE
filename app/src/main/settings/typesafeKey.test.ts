import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TypesafeKeyStore, defaultTypesafeKeyPath, type SecureStringCodec } from './typesafeKey'

/** A real, reversible fake codec — not real security, just enough to prove the round-trip/file logic without Electron's real safeStorage. */
function fakeCodec(available = true): SecureStringCodec {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
    decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString('utf8'),
  }
}

function scratchPath(): string {
  return defaultTypesafeKeyPath(mkdtempSync(join(tmpdir(), 'laird-typesafe-key-')))
}

describe('TypesafeKeyStore', () => {
  it('reports no key configured before one is set', () => {
    const store = new TypesafeKeyStore(scratchPath(), fakeCodec())
    expect(store.hasKey()).toBe(false)
    expect(store.getKey()).toBeNull()
  })

  it('round-trips a real key through set/get', () => {
    const store = new TypesafeKeyStore(scratchPath(), fakeCodec())
    store.setKey('sk-test-123')
    expect(store.hasKey()).toBe(true)
    expect(store.getKey()).toBe('sk-test-123')
  })

  it('clears a stored key', () => {
    const store = new TypesafeKeyStore(scratchPath(), fakeCodec())
    store.setKey('sk-test-123')
    store.clearKey()
    expect(store.hasKey()).toBe(false)
    expect(store.getKey()).toBeNull()
  })

  it('refuses to store a key when secure storage is unavailable, rather than falling back to plaintext', () => {
    const store = new TypesafeKeyStore(scratchPath(), fakeCodec(false))
    expect(() => store.setKey('sk-test-123')).toThrow(/not available/)
    expect(store.hasKey()).toBe(false)
  })

  it('getKey returns null rather than throwing if the stored file is corrupt', () => {
    const path = scratchPath()
    const store = new TypesafeKeyStore(path, fakeCodec())
    store.setKey('sk-test-123')
    writeFileSync(path, 'not json')
    expect(store.getKey()).toBeNull()
  })
})
