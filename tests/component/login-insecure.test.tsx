// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '~/app/store/app-store'
import { AppStoreProvider } from '~/app/store/app-store-provider'
import { LoginForm } from '~/features/auth/login-form'

// vi.mock is hoisted above the imports, so the flag it reads must be hoisted too.
const secure = vi.hoisted(() => ({ insecure: true }))

vi.mock('~/platform/secure-context', () => ({
  isInsecureContext: () => secure.insecure,
  hasWebCrypto: () => true,
  INSECURE_CONTEXT_MESSAGE: 'Koneksi tidak aman',
}))

function renderLogin() {
  const store = createAppStore()
  store.setState({
    ready: true,
    user: null,
    deviceId: 'device-test',
    online: true,
    pendingCount: 0,
    syncing: false,
    pullProgress: { running: false, kind: '', fetched: 0, total: 0 },
    lastPullAt: null,
    credentials: [],
    sessionTtlDaysLeft: null,
  })
  return render(
    <AppStoreProvider store={store}>
      <LoginForm />
    </AppStoreProvider>,
  )
}

describe('LoginForm di koneksi tidak aman', () => {
  afterEach(() => {
    secure.insecure = true
  })

  it('menampilkan peringatan agar memakai https', () => {
    renderLogin()
    // Read synchronously (useSyncExternalStore): present on the first render, no waiting needed.
    expect(screen.getByRole('alert')).toHaveTextContent('Koneksi tidak aman')
  })

  it('tidak menampilkan peringatan pada koneksi aman', () => {
    secure.insecure = false
    renderLogin()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
