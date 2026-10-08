import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAppStore } from '~/app/store/app-store'
import { isInsecureContext } from '~/platform/secure-context'
import { Button, Card, Field, Notice, inputClass } from '~/ui/primitives'

// The secure-context flag never changes while the page is open: nothing to subscribe to.
const subscribeNever = () => () => {}
// The SPA shell is prerendered in Node, where `window` does not exist: render without the banner there.
const insecureOnServer = () => false

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
  // Read synchronously on the client (no effect), so the banner is part of the first client render
  // and does not shift the layout after paint.
  const insecureContext = useSyncExternalStore(subscribeNever, isInsecureContext, insecureOnServer)

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
      setResult({
        ok: false,
        message: 'Login gagal. Periksa koneksi atau kredensial, lalu coba lagi.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-black tracking-tight text-brand-bright">StockOps</h1>
        <p className="mt-1 text-fg-muted">Penerimaan Barang — Perangkat PDT</p>
        <p className="mt-2">
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
              online ? 'bg-ok-fill text-on-ok-fill' : 'bg-danger-fill text-on-danger-fill'
            }`}
          >
            {online ? 'Online' : 'Offline'}
          </span>
        </p>
      </div>

      {insecureContext ? (
        <div
          role="alert"
          className="rounded-lg bg-warn px-4 py-3 text-base font-semibold text-on-warn"
        >
          Koneksi tidak aman (http://). Login dan mode offline membutuhkan alamat https://. Minta
          admin alamat aplikasi yang benar.
        </div>
      ) : null}

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
              className={`${inputClass} w-full border-line-strong`}
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

          {result ? (
            <Notice tone={result.ok ? 'success' : 'danger'}>{result.message}</Notice>
          ) : null}

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
        className={`${inputClass} w-full border-line-strong pr-12`}
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
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-fg-subtle transition hover:text-fg focus:text-fg"
      >
        {showPassword ? (
          <EyeOff className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Eye className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
