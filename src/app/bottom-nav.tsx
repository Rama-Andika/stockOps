import { Link } from '@tanstack/react-router'
import { Barcode, ClipboardList, Settings } from 'lucide-react'
import { useAppStore } from '~/app/store/app-store'

const NAV_LINK_CLASS =
  'touch-target relative flex flex-1 flex-col items-center justify-center rounded-lg px-2 py-1 text-center'

const NAV_ITEMS = [
  { to: '/pos', label: 'Purchase Order', icon: ClipboardList },
  { to: '/sessions', label: 'Penerimaan', icon: Barcode },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
] as const

export function BottomNav() {
  const pendingCount = useAppStore((state) => state.pendingCount)

  return (
    <nav className="border-t border-line bg-chrome/95 px-2 py-1 backdrop-blur">
      <div className="flex items-stretch justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const badge = item.to === '/sessions' && pendingCount > 0 ? pendingCount : null
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={NAV_LINK_CLASS}
              activeProps={{
                // The router applies EITHER activeProps or inactiveProps, never both, so the two
                // text colours can no longer collide and no important modifier is needed.
                className: 'bg-raised text-brand-bright font-semibold',
                'aria-current': 'page',
              }}
              inactiveProps={{
                className: 'text-fg-muted hover:text-fg',
              }}
            >
              <div className="relative">
                <Icon className="h-5 w-5" aria-hidden="true" />
                {badge ? (
                  <span
                    aria-label={`${badge} sesi menunggu sinkronisasi`}
                    className="absolute -right-2.5 -top-1.5 rounded-full bg-warn px-1.5 text-[10px] font-bold leading-tight text-on-warn"
                  >
                    {badge}
                  </span>
                ) : null}
              </div>
              <span className="mt-1 text-xs font-medium tracking-tight truncate max-w-full">
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
