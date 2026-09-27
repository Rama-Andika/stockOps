import { useEffect, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useAppStore } from "~/client/state/store/app-store";
import { registerServiceWorker } from "~/client/pwa";
import { Loading } from "./ui";
import { ToastHost } from "./toast-host";
import { Barcode, ClipboardList, Inbox, Settings, Upload } from "lucide-react";

const NAV_LINK_CLASS =
  "touch-target relative flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-center font-semibold";

const NAV_ITEMS = [
  { to: "/pos", label: "PO", icon: ClipboardList },
  { to: "/sessions", label: "Sesi", icon: Barcode },
  { to: "/settings", label: "Pengaturan", icon: Settings },
] as const;

function TopBar() {
  const online = useAppStore((state) => state.online);
  const pendingCount = useAppStore((state) => state.pendingCount);
  const syncing = useAppStore((state) => state.syncing);
  const sync = useAppStore((state) => state.sync);
  const user = useAppStore((state) => state.user);

  return (
    <header className="sticky top-0 z-10 border-b border-slate-700 bg-slate-950/95 backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center  gap-2">
          <span className="text-lg font-black tracking-tight text-cyan-400">
            StockOps
          </span>
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
              online
                ? "bg-emerald-800 text-emerald-100"
                : "bg-red-800 text-red-100"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-400" : "bg-red-400"}`}
            />
            {online ? "Online" : "Offline"}
          </span>
        </div>
        {user ? (
          <span className="hidden text-sm text-slate-300 sm:inline">
            {user.fullName}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2">
        {pendingCount > 0 ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
            <Inbox className="h-4 w-4" aria-hidden="true" />
            {pendingCount} dokumen menunggu kirim
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
            <Inbox className="h-4 w-4" aria-hidden="true" />
            Tidak ada dokumen menunggu
          </span>
        )}
        <button
          type="button"
          aria-label="Upload"
          className={`flex items-center justify-center rounded-lg p-2 transition ${
            pendingCount > 0
              ? "bg-cyan-500 text-slate-900 hover:bg-cyan-400"
              : "bg-slate-700 text-slate-100 hover:bg-slate-600"
          } disabled:cursor-not-allowed disabled:opacity-60`}
          disabled={!online || syncing}
          onClick={() => void sync()}
        >
          <Upload className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function BottomNav() {
  const pendingCount = useAppStore((state) => state.pendingCount);

  return (
    <nav className="sticky bottom-0 border-t border-slate-700 bg-slate-950/95 px-2 py-1 backdrop-blur">
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
              className={`${NAV_LINK_CLASS} text-slate-300`}
              activeProps={{
                className: `${NAV_LINK_CLASS} bg-slate-800 text-cyan-400`,
                "aria-current": "page",
              }}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {badge ? (
                <span
                  aria-label={`${badge} sesi menunggu sinkronisasi`}
                  className="absolute right-2 top-1 rounded-full bg-amber-400 px-1.5 text-xs font-bold text-slate-950"
                >
                  {badge}
                </span>
              ) : null}
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

  return (
    <div className="flex min-h-screen flex-col">
      <ToastHost />
      <TopBar />
      <main className="flex-1 p-3">
        <div className="mx-auto w-full max-w-3xl">{children ?? <Outlet />}</div>
      </main>
      <BottomNav />
    </div>
  );
}
