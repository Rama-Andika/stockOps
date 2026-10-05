import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAppStore } from '~/client/state/store/app-store'
import { Button, Card, Field, Notice, inputClass } from './ui'

export function LoginForm() {
  const online = useAppStore((state) => state.online)
  const ready = useAppStore((state) => state.ready)
  const loginOnline = useAppStore((state) => state.loginOnline)
  const loginOffline = useAppStore((state) => state.loginOffline)
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const idRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    idRef.current?.focus()
  }, [])

  const submit = async () => {
    setBusy(true)
    setResult(null)
    try {
      let response
      if (!online) {
        response = await loginOffline(loginId.trim(), password)
      } else {
        try {
          response = await loginOnline(loginId.trim(), password)
        } catch {
          // Network status can lag behind actual server connection. Try local
          // credentials only if the online request failed at the transport level; login
          // rejection from the server is still displayed and not bypassed with offline login.
          response = await loginOffline(loginId.trim(), password)
        }
      }
      setResult(response)
      if (response.ok) setPassword('')
    } catch {
      setResult({ ok: false, message: 'Login gagal. Periksa koneksi atau kredensial, lalu coba lagi.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-black tracking-tight text-cyan-400">StockOps</h1>
        <p className="mt-1 text-slate-300">Penerimaan Barang — Perangkat PDT</p>
        <p className="mt-2">
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
              online ? 'bg-emerald-800 text-emerald-100' : 'bg-red-800 text-red-100'
            }`}
          >
            {online ? 'Online' : 'Offline'}
          </span>
        </p>
      </div>

      <Card title="Masuk">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && ready) void submit()
          }}
        >
          <Field label="ID Pengguna">
            <input
              ref={idRef}
              aria-label="ID Pengguna"
              className={inputClass}
              value={loginId}
              autoComplete="username"
              onChange={(event) => setLoginId(event.target.value)}
            />
          </Field>

          <Field
            label="Password"
            hint={
              online
                ? 'Terhubung ke server & database pusat.'
                : 'Mode offline: hanya berlaku bila pernah login online di perangkat ini (maks. 7 hari).'
            }
          >
            <PasswordField value={password} onChange={setPassword} />
          </Field>

          {result ? <Notice tone={result.ok ? 'success' : 'danger'}>{result.message}</Notice> : null}

          <Button type="submit" disabled={busy || !loginId || !password} className="w-full">
            {busy ? 'Memproses…' : 'Masuk'}
          </Button>
        </form>
      </Card>
    </main>
  )
}

function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [showPassword, setShowPassword] = useState(false)
  return (
    <div className="relative">
      <input
        aria-label="Password"
        className={`${inputClass} pr-12`}
        type={showPassword ? 'text' : 'password'}
        value={value}
        autoComplete="current-password"
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
        aria-pressed={showPassword}
        title={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
        onClick={() => setShowPassword((value) => !value)}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-slate-400 transition hover:text-slate-100 focus:text-slate-100"
      >
        {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  )
}

