import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasWebCrypto, isInsecureContext } from '~/client/secure-context'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isInsecureContext', () => {
  it('false bila tidak ada window (prerender di Node)', () => {
    vi.stubGlobal('window', undefined)
    expect(isInsecureContext()).toBe(false)
  })

  it('true hanya bila isSecureContext === false (http://<IP-LAN>)', () => {
    vi.stubGlobal('window', { isSecureContext: false })
    expect(isInsecureContext()).toBe(true)
  })

  it('false bila isSecureContext true (https:// atau localhost)', () => {
    vi.stubGlobal('window', { isSecureContext: true })
    expect(isInsecureContext()).toBe(false)
  })

  it('false bila isSecureContext tidak tersedia (undefined), tidak menebak', () => {
    vi.stubGlobal('window', {})
    expect(isInsecureContext()).toBe(false)
  })
})

describe('hasWebCrypto', () => {
  it('true bila crypto.subtle tersedia', () => {
    vi.stubGlobal('crypto', { subtle: {} })
    expect(hasWebCrypto()).toBe(true)
  })

  it('false bila crypto ada tetapi subtle tidak (konteks tidak aman)', () => {
    vi.stubGlobal('crypto', {})
    expect(hasWebCrypto()).toBe(false)
  })

  it('false bila crypto tidak ada sama sekali', () => {
    vi.stubGlobal('crypto', undefined)
    expect(hasWebCrypto()).toBe(false)
  })
})
