import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INSECURE_CONTEXT_MESSAGE } from '~/platform/secure-context'
import { createAppStore } from '~/app/store/app-store'
import { serverTransport } from '~/features/sync/transport'

// The store talks to the server only through this transport; replace it so the
// test can prove whether a login attempt reached the server at all.
vi.mock('~/features/sync/transport', () => ({
  serverTransport: {
    login: vi.fn(),
    checkCredentials: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
  },
}))

const login = vi.mocked(serverTransport.login)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Minimal browser-like environment: isBrowser() needs both `window` and `indexedDB`. */
function stubBrowser() {
  vi.stubGlobal('window', {})
}

describe('guard WebCrypto di login (konteks tidak aman)', () => {
  it('loginOnline gagal lebih awal dan TIDAK memanggil server bila crypto.subtle tidak ada', async () => {
    stubBrowser()
    vi.stubGlobal('crypto', {})
    const result = await createAppStore().getState().loginOnline('pdt', 'pdt123')
    expect(result).toEqual({ ok: false, message: INSECURE_CONTEXT_MESSAGE })
    expect(login).not.toHaveBeenCalled()
  })

  it('loginOffline gagal lebih awal dengan pesan yang sama', async () => {
    stubBrowser()
    vi.stubGlobal('crypto', {})
    const result = await createAppStore().getState().loginOffline('pdt', 'pdt123')
    expect(result).toEqual({ ok: false, message: INSECURE_CONTEXT_MESSAGE })
  })

  it('kontrol: dengan crypto.subtle tersedia, loginOnline tetap menghubungi server', async () => {
    stubBrowser()
    login.mockResolvedValue({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'ID atau password salah.',
    })
    const result = await createAppStore().getState().loginOnline('pdt', 'salah')
    expect(login).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: false, message: 'ID atau password salah.' })
  })
})
