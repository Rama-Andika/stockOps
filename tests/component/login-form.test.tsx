// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAppStore } from '~/app/store/app-store'
import { AppStoreProvider } from '~/app/store/app-store-provider'
import type { AppState } from '~/app/store/types'
import { LoginForm } from '~/features/auth/login-form'

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
  it('menampilkan satu tombol Masuk tanpa pilihan mode', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Online' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Offline' })).not.toBeInTheDocument()
  })

  it('tombol kirim nonaktif sebelum ID & password diisi', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeEnabled()
  })

  it('memakai loginOnline saat online', async () => {
    const loginOnline = vi.fn(async () => ({ ok: true, message: 'Login berhasil.' }))
    renderLogin({ online: true, loginOnline })
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: ' pdt ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    await waitFor(() => expect(loginOnline).toHaveBeenCalledWith('pdt', 'pdt123'))
    expect(await screen.findByRole('status')).toHaveTextContent('Login berhasil.')
  })

  it('memakai loginOffline saat offline dan menjelaskan batas tujuh hari', async () => {
    const loginOffline = vi.fn(async () => ({ ok: true, message: 'Login offline berhasil.' }))
    renderLogin({ online: false, loginOffline })
    expect(screen.getByText(/maks\. 7 hari/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    await waitFor(() => expect(loginOffline).toHaveBeenCalledWith('pdt', 'pdt123'))
  })

  it('mencoba login offline bila request online gagal karena koneksi', async () => {
    const loginOnline = vi.fn(async () => {
      throw new Error('Koneksi server gagal')
    })
    const loginOffline = vi.fn(async () => ({ ok: true, message: 'Login offline berhasil.' }))
    renderLogin({ online: true, loginOnline, loginOffline })
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pdt123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    await waitFor(() => expect(loginOnline).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(loginOffline).toHaveBeenCalledWith('pdt', 'pdt123'))
    expect(await screen.findByRole('status')).toHaveTextContent('Login offline berhasil.')
  })

  it('menampilkan pesan kegagalan login', async () => {
    const loginOnline = vi.fn(async () => ({ ok: false, message: 'ID atau password salah.' }))
    renderLogin({ loginOnline })
    fireEvent.change(screen.getByLabelText('ID Pengguna'), { target: { value: 'pdt' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'salah' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByRole('status')).toHaveTextContent('ID atau password salah.')
  })
})
