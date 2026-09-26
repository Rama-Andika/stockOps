import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '~/client/state/store/app-store'
import { Button, Card, Field, Notice, inputClass } from './ui'

export interface LoginFormProps {
  initialMode?: 'online' | 'offline'
}

export function LoginForm({ initialMode }: LoginFormProps) {
  const online = useAppStore((state) => state.online)
  const ready = useAppStore((state) => state.ready)
  const loginOnline = useAppStore((state) => state.loginOnline)
  const loginOffline = useAppStore((state) => state.loginOffline)
  const [mode, setMode] = useState<'online' | 'offline'>(initialMode ?? (online ? 'online' : 'offline'))
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
      const response =
        mode === 'online'
          ? await loginOnline(loginId.trim(), password)
          : await loginOffline(loginId.trim(), password)
      setResult(response)
      if (response.ok) setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-black tracking-tight text-cyan-400">StockOps</h1>
        <p className="mt-1 text-slate-300">Penerimaan Barang — Perangkat PDT</p>
      </div>

      <Card title="Masuk">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && ready) void submit()
          }}
        >
          <div className="flex gap-2">
            <Button
              variant={mode === 'online' ? 'primary' : 'secondary'}
              className="flex-1"
              onClick={() => setMode('online')}
            >
              Online
            </Button>
            <Button
              variant={mode === 'offline' ? 'primary' : 'secondary'}
              className="flex-1"
              onClick={() => setMode('offline')}
            >
              Offline
            </Button>
          </div>

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
              mode === 'offline'
                ? 'Login offline hanya berlaku bila pernah login online di perangkat ini (maks. 7 hari).'
                : 'Login online memerlukan koneksi ke server & database pusat.'
            }
          >
            <PasswordField value={password} onChange={setPassword} />
          </Field>

          {result ? <Notice tone={result.ok ? 'success' : 'danger'}>{result.message}</Notice> : null}

          <Button type="submit" disabled={busy || !loginId || !password} className="w-full">
            {busy ? 'Memproses…' : mode === 'online' ? 'Masuk Online' : 'Masuk Offline'}
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
        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  )
}