import { useAppStore } from '~/app/store/app-store'
import { ThemeToggle } from '~/app/theme-toggle'
import { UpdateBanner } from '~/app/update-banner'
import { SyncStatus, useSendStatus } from '~/features/sync/sync-status'

export function TopBar() {
  const online = useAppStore((state) => state.online)
  // The app bar's status row is shared. `SyncStatus` renders nothing while it is quiet, and only
  // then may the update banner take the row — see the comment on `useSendStatus`. The decision
  // lives here, in the component that owns the layout, so that `UpdateBanner` stays a component a
  // test can render on its own.
  const { quiet } = useSendStatus()
  const user = useAppStore((state) => state.user)

  return (
    <header className="border-b border-line bg-chrome/95 backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center  gap-2">
          <span className="text-lg font-black tracking-tight text-brand-bright">StockOps</span>
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
              online ? 'bg-ok-fill text-on-ok-fill' : 'bg-danger-fill text-on-danger-fill'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-ok-dot' : 'bg-danger-dot'}`}
            />
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
        {user ? (
          <span className="hidden text-sm text-fg-muted sm:inline">{user.fullName}</span>
        ) : null}
        <ThemeToggle />
      </div>
      {quiet ? <UpdateBanner /> : null}
      <SyncStatus />
    </header>
  )
}
