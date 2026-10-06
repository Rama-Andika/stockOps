import { useEffect, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useAppStore } from "~/client/state/store/app-store";
import { registerServiceWorker } from "~/client/pwa";
import { applyContrastPreference } from "~/client/theme";
import { Loading } from "./ui";
import { ToastHost } from "./toast-host";
import { Barcode, ClipboardList, Settings } from "lucide-react";
import { SyncStatus } from "./sync-status";

// z-index scale used across the app, highest first:
//   60 toast (ToastHost) · 40 dialogs (LineEditSheet) · 30 keypad sheet (ScanBar).
// The shell itself needs none: it is a fixed-height flex column where <main> is the only scroller.
const NAV_LINK_CLASS =
  "touch-target relative flex flex-1 flex-col items-center justify-center rounded-lg px-2 py-1 text-center";

const NAV_ITEMS = [
  { to: "/pos", label: "Purchase Order", icon: ClipboardList },
  { to: "/sessions", label: "Penerimaan", icon: Barcode },
  { to: "/settings", label: "Pengaturan", icon: Settings },
] as const;

function TopBar() {
  const online = useAppStore((state) => state.online);
  const user = useAppStore((state) => state.user);

  return (
    <header className="border-b border-line bg-chrome/95 backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center  gap-2">
          <span className="text-lg font-black tracking-tight text-brand-bright">
            StockOps
          </span>
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
              online
                ? "bg-ok-fill text-on-ok-fill"
                : "bg-danger-fill text-on-danger-fill"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full ${online ? "bg-ok-dot" : "bg-danger-dot"}`}
            />
            {online ? "Online" : "Offline"}
          </span>
        </div>
        {user ? (
          <span className="hidden text-sm text-fg-muted sm:inline">
            {user.fullName}
          </span>
        ) : null}
      </div>
      <SyncStatus />
    </header>
  );
}

function BottomNav() {
  const pendingCount = useAppStore((state) => state.pendingCount);

  return (
    <nav className="border-t border-line bg-chrome/95 px-2 py-1 backdrop-blur">
      <div className="flex items-stretch justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const badge =
            item.to === "/sessions" && pendingCount > 0 ? pendingCount : null;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={NAV_LINK_CLASS}
              activeProps={{
                // The router applies EITHER activeProps or inactiveProps, never both, so the two
                // text colours can no longer collide and no important modifier is needed.
                className: "bg-raised text-brand-bright font-semibold",
                "aria-current": "page",
              }}
              inactiveProps={{
                className: "text-fg-muted hover:text-fg",
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
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const ready = useAppStore((state) => state.ready);
  const user = useAppStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname === "/login";

  useEffect(() => {
    registerServiceWorker();
    applyContrastPreference();
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user && !isLogin) void navigate({ to: "/login" });
    if (user && isLogin) void navigate({ to: "/pos" });
  }, [ready, user, isLogin, navigate]);

  if (!ready) {
    return (
      <main className="p-4">
        <Loading label="Menyiapkan aplikasi…" />
      </main>
    );
  }

  if (isLogin) {
    return <div className="min-h-screen">{children ?? <Outlet />}</div>;
  }

  // The receiving session is a fixed-height cockpit: it manages its own scrolling, fills the
  // shell without padding or a max width, and hides the global nav so two stacked bars do not
  // eat 112px of a 640px screen. To undo that decision, drop this flag and always render
  // <BottomNav /> plus the padded wrapper below.
  // Exactly one segment after /sessions/ — i.e. the session detail route only.
  const isCockpit = /^\/sessions\/[^/]+$/.test(location.pathname);
  // The review step opts in explicitly, as the note above requires: it implements its own h-full
  // column with an internal scroller, so it needs the same chrome-free, fixed-height main as the
  // cockpit. Without this it would get the padded, globally-navigated layout and show BottomNav
  // stacked under its own pinned send footer — two bars eating 112px of a 640px screen.
  const isReview = /^\/sessions\/review\/[^/]+$/.test(location.pathname);
  const isSessionFlow = isCockpit || isReview;

  return (
    <div className="app-viewport flex flex-col">
      <ToastHost />
      <TopBar />
      <main
        className={
          isSessionFlow
            ? "min-h-0 flex-1 overflow-hidden"
            : "min-h-0 flex-1 overflow-y-auto p-3"
        }
      >
        {isSessionFlow ? (
          children ?? <Outlet />
        ) : (
          <div className="mx-auto w-full max-w-3xl">{children ?? <Outlet />}</div>
        )}
      </main>
      {isSessionFlow ? null : <BottomNav />}
    </div>
  );
}
