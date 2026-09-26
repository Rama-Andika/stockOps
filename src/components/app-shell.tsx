import { useEffect, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useAppStore } from '~/client/state/store/app-store'
import { registerServiceWorker } from '~/client/pwa'
import { Badge, Button, Loading } from './ui'
import { SESSION_STATUS_LABEL, SESSION_STATUS } from '~/shared/constants'

const NAV_ITEMS = [
  { to: '/pos', label: 'PO' },
  { to: '/sessions', label: 'Sesi' },
  { to: '/settings', label: 'Pengaturan' },
] as const

function TopBar() {
  const online = useAppStore((state) => state.online)
  const pendingCount = useAppStore((state) => state.pendingCount)
  const syncing = useAppStore((state) => state.syncing)
  const sync = useAppStore((state) => state.sync)
  const user = useAppStore((state) => state.user)
  return (
    <header className="sticky top-0 z-10 border-b border-slate-700 bg-slate-950/95 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tight text-cyan-400">StockOps</span>
          <Badge tone={online ? 'success' : 'danger'}>{online ? 'Online' : 'Offline'}</Badge>
          <Badge tone={pendingCount > 0 ? 'warn' : 'neutral'}>
            {pendingCount > 0 ? `${pendingCount} antre` : 'Antrean kosong'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {user ? <span className="hidden text-sm text-slate-300 sm:inline">{user.fullName}</span> : null}
          <Button
            variant="secondary"
            className="!px-3 !py-2 text-sm"
            disabled={!online || syncing}
            onClick={() => void sync()}
          >
            {syncing ? 'Mengirim…' : 'Sinkron'}
          </Button>
        </div>
      </div>
    </header>
  )
}

function BottomNav() {
  return (
    <nav className="sticky bottom-0 border-t border-slate-700 bg-slate-950/95 px-2 py-1 backdrop-blur">
      <div className="flex items-stretch justify-around">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="touch-target flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-center font-semibold text-slate-300"
            activeProps={{ className: 'text-cyan-400' }}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const ready = useAppStore((state) => state.ready)
  const user = useAppStore((state) => state.user)
  const location = useLocation()
  const navigate = useNavigate()
  const isLogin = location.pathname === '/login'

  useEffect(() => {
    registerServiceWorker()
  }, [])

  useEffect(() => {
    if (!ready) return
    if (!user && !isLogin) void navigate({ to: '/login' })
    if (user && isLogin) void navigate({ to: '/pos' })
  }, [ready, user, isLogin, navigate])

  if (!ready) {
    return (
      <main className="p-4">
        <Loading label="Menyiapkan aplikasi…" />
      </main>
    )
  }

  if (isLogin) {
    return <div className="min-h-screen">{children ?? <Outlet />}</div>
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="flex-1 p-3">
        <div className="mx-auto w-full max-w-3xl">{children ?? <Outlet />}</div>
      </main>
      <BottomNav />
      <span className="sr-only">{SESSION_STATUS_LABEL[SESSION_STATUS.RUNNING]}</span>
    </div>
  )
}
