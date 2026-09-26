import { useState } from 'react'
import { useApp } from '~/client/state/app-context'
import { Button, Card, Field, Notice, inputClass } from './ui'

export interface LoginFormProps {
  initialMode?: 'online' | 'offline'
}

export function LoginForm({ initialMode }: LoginFormProps) {
  const { online, loginOnline, loginOffline, ready } = useApp()
  const [mode, setMode] = useState<'online' | 'offline'>(initialMode ?? (online ? 'online' : 'offline'))
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

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
              aria-label="ID Pengguna"
              className={inputClass}
              value={loginId}
              autoFocus
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
            <input
              aria-label="Password"
              className={inputClass}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
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
