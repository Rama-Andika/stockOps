import { useEffect, useRef, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { BottomNav } from '~/app/bottom-nav'
import { useAppStore } from '~/app/store/app-store'
import { checkForUpdate, registerServiceWorker } from '~/app/pwa'
import { TopBar } from '~/app/top-bar'
import { installErrorTrap } from '~/features/diagnostics/error-trap'
import { applyThemePreference } from '~/platform/theme'
import { ScrollContainerProvider } from '~/ui/virtual/scroll-container'
import { Loading } from '~/ui/primitives'
import { ToastHost } from '~/ui/toast-host'

// z-index scale used across the app, highest first:
//   60 toast (ToastHost) · 40 dialogs (LineEditSheet) · 30 keypad sheet (ScanBar).
// The shell itself needs none: it is a fixed-height flex column where <main> is the only scroller.
export function AppShell({ children }: { children: ReactNode }) {
  const ready = useAppStore((state) => state.ready)
  const markUpdateReady = useAppStore((state) => state.markUpdateReady)
  const online = useAppStore((state) => state.online)
  const user = useAppStore((state) => state.user)
  const location = useLocation()
  const navigate = useNavigate()
  const isLogin = location.pathname === '/login'
  const mainRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // First in this effect on purpose: everything after it may throw, and the trap is what turns
    // such a throw into something IT can read later instead of a blank screen nobody can explain.
    installErrorTrap()
    registerServiceWorker(markUpdateReady)
    applyThemePreference()
    // `markUpdateReady` is a zustand action and therefore a stable reference, so this effect still
    // runs exactly once. It is in the deps because it is used, not because it changes.
  }, [markUpdateReady])

  // Ask for a new build whenever the device comes back online.
  //
  // `register()` above already performs one update check per app start, but a PDT is opened once
  // in the morning and left open: SPA navigation never remounts this shell, so without this the
  // only remaining path for the rest of the shift is the manual button in Pengaturan. Going
  // offline and back is the one thing that reliably happens on a warehouse floor.
  //
  // Deliberately NOT gated on a logged-in user, unlike the auto-sync effect in
  // app-store-provider.tsx: this reaches no ERP data and needs no credentials. It is also safe on
  // the first run, when `registration` is not resolved yet — `checkForUpdate` is a no-op then,
  // and the registration's own check covers that moment.
  useEffect(() => {
    if (!online) return
    void checkForUpdate()
  }, [online])

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

  // The receiving session is a fixed-height cockpit: it manages its own scrolling, fills the
  // shell without padding or a max width, and hides the global nav so two stacked bars do not
  // eat 112px of a 640px screen. To undo that decision, drop this flag and always render
  // <BottomNav /> plus the padded wrapper below.
  // Exactly one segment after /sessions/ — i.e. the session detail route only.
  const isCockpit = /^\/sessions\/[^/]+$/.test(location.pathname)
  // The review step opts in explicitly, as the note above requires: it implements its own h-full
  // column with an internal scroller, so it needs the same chrome-free, fixed-height main as the
  // cockpit. Without this it would get the padded, globally-navigated layout and show BottomNav
  // stacked under its own pinned send footer — two bars eating 112px of a 640px screen.
  const isReview = /^\/sessions\/review\/[^/]+$/.test(location.pathname)
  const isSessionFlow = isCockpit || isReview

  return (
    <div className="app-viewport flex flex-col">
      <ToastHost />
      <TopBar />
      {/* The ref is handed down so a long list inside the route can render only what is on screen
          (see ui/virtual/virtual-list.tsx). <main> is the scroller for every screen EXCEPT the two
          session screens, where it is overflow-hidden and the route owns its own scroller: the
          cockpit overrides this context with that scroller, and the review screen has no long
          list. Provided in both branches anyway — the value is a ref, and an override is one
          component away. */}
      <main
        ref={mainRef}
        className={
          isSessionFlow ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto p-3'
        }
      >
        <ScrollContainerProvider value={mainRef}>
          {isSessionFlow ? (
            (children ?? <Outlet />)
          ) : (
            <div className="mx-auto w-full max-w-3xl">{children ?? <Outlet />}</div>
          )}
        </ScrollContainerProvider>
      </main>
      {isSessionFlow ? null : <BottomNav />}
    </div>
  )
}
