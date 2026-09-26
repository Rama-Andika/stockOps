// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppContext, type AppContextValue } from '~/client/state/app-context'
import { LoginForm } from '~/components/login-form'

function makeContext(overrides: Partial<AppContextValue> = {}): AppContextValue {
  return {
    ready: true,
    user: null,
    deviceId: 'device-test',
    online: true,
    pendingCount: 0,
    syncing: false,
    pulling: { running: false, kind: '', fetched: 0, total: 0 },
    lastPullAt: null,
    credentials: [],
    sessionTtlDaysLeft: null,
    refreshState: async () => {},
    loginOnline: async () => ({ ok: true, message: 'Login berhasil.' }),
    loginOffline: async () => ({ ok: true, message: 'Login offline berhasil.' }),
    logout: async () => {},
    downloadData: async () => ({ ok: true, message: 'ok' }),
    syncNow: async () => ({ ok: true, message: 'ok' }),
    refreshPurchasesNow: async () => ({ ok: true, message: 'ok' }),
    ...overrides,
  }
}

function renderLogin(context: AppContextValue) {
  return render(
    <AppContext.Provider value={context}>
      <LoginForm />
    </AppContext.Provider>,
  )
}

describe('LoginForm', () => {
  it('default mode online saat perangkat online', () => {
    renderLogin(makeContext({ online: true }))
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeInTheDocument()
  })

  it('default mode offline saat perangkat offline', () => {
    renderLogin(makeContext({ online: false }))
    expect(screen.getByRole('button', { name: 'Masuk Offline' })).toBeInTheDocument()
  })

  it('tombol kirim nonaktif sebelum ID & password diisi', () => {
    renderLogin(makeContext())
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeEnabled()
  })

  it('memanggil loginOnline dengan kredensial yang diisi', async () => {
    const loginOnline = vi.fn(async () => ({ ok: true, message: 'Login berhasil.' }))
    renderLogin(makeContext({ loginOnline }))
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: ' pdt ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Online' }))
    await waitFor(() => expect(loginOnline).toHaveBeenCalledWith('pdt', 'pdt123'))
    expect(await screen.findByRole('status')).toHaveTextContent('Login berhasil.')
  })

  it('berpindah ke mode offline memanggil loginOffline & menampilkan batas 7 hari', async () => {
    const loginOffline = vi.fn(async () => ({ ok: true, message: 'Login offline berhasil.' }))
    renderLogin(makeContext({ loginOffline }))

    fireEvent.click(screen.getByRole('button', { name: 'Offline' }))
    expect(screen.getByText(/maks\. 7 hari/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Offline' }))

    await waitFor(() => expect(loginOffline).toHaveBeenCalledWith('pdt', 'pdt123'))
  })

  it('menampilkan pesan kegagalan login', async () => {
    const loginOnline = vi.fn(async () => ({ ok: false, message: 'ID atau password salah.' }))
    renderLogin(makeContext({ loginOnline }))
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'salah' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Online' }))
    expect(await screen.findByRole('status')).toHaveTextContent('ID atau password salah.')
  })
})
