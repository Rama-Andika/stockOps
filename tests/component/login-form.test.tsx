// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAppStore } from '~/client/state/store/app-store'
import { AppStoreProvider } from '~/client/state/store/app-store-provider'
import type { AppState } from '~/client/state/store/types'
import { LoginForm } from '~/components/login-form'

const baseState = {
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
}

function renderLogin(overrides: Partial<AppState> = {}) {
  const store = createAppStore()
  store.setState({ ...baseState, ...overrides })
  return render(
    <AppStoreProvider store={store}>
      <LoginForm />
    </AppStoreProvider>,
  )
}

describe('LoginForm', () => {
  it('default mode online saat perangkat online', () => {
    renderLogin({ online: true })
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeInTheDocument()
  })

  it('default mode offline saat perangkat offline', () => {
    renderLogin({ online: false })
    expect(screen.getByRole('button', { name: 'Masuk Offline' })).toBeInTheDocument()
  })

  it('tombol kirim nonaktif sebelum ID & password diisi', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    expect(screen.getByRole('button', { name: 'Masuk Online' })).toBeEnabled()
  })

  it('memanggil loginOnline dengan kredensial yang diisi', async () => {
    const loginOnline = vi.fn(async () => ({ ok: true, message: 'Login berhasil.' }))
    renderLogin({ loginOnline })
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: ' pdt ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Online' }))
    await waitFor(() => expect(loginOnline).toHaveBeenCalledWith('pdt', 'pdt123'))
    expect(await screen.findByRole('status')).toHaveTextContent('Login berhasil.')
  })

  it('berpindah ke mode offline memanggil loginOffline & menampilkan batas 7 hari', async () => {
    const loginOffline = vi.fn(async () => ({ ok: true, message: 'Login offline berhasil.' }))
    renderLogin({ loginOffline })

    fireEvent.click(screen.getByRole('button', { name: 'Offline' }))
    expect(screen.getByText(/maks\. 7 hari/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Offline' }))

    await waitFor(() => expect(loginOffline).toHaveBeenCalledWith('pdt', 'pdt123'))
  })

  it('menampilkan pesan kegagalan login', async () => {
    const loginOnline = vi.fn(async () => ({ ok: false, message: 'ID atau password salah.' }))
    renderLogin({ loginOnline })
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'salah' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk Online' }))
    expect(await screen.findByRole('status')).toHaveTextContent('ID atau password salah.')
  })
})