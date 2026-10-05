import { useEffect, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useAppStore } from "~/client/state/store/app-store";
import { registerServiceWorker } from "~/client/pwa";
import { Loading } from "./ui";
import { ToastHost } from "./toast-host";
import { Barcode, ClipboardList, Inbox, Settings, Upload } from "lucide-react";

const NAV_LINK_CLASS =
  "touch-target relative flex flex-1 flex-col items-center justify-center rounded-lg px-2 py-1 text-center";

const NAV_ITEMS = [
  { to: "/pos", label: "Purchase Order", icon: ClipboardList },
  { to: "/sessions", label: "Penerimaan", icon: Barcode },
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
      {pendingCount > 0 || syncing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
            <Inbox className="h-4 w-4" aria-hidden="true" />
            {pendingCount} dokumen belum terkirim
          </span>
          <button
            type="button"
            aria-label={syncing ? "Sedang mengirim…" : "Kirim dokumen yang belum terkirim"}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-200"
            disabled={!online || syncing}
            onClick={() => void sync()}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{syncing ? "Mengirim…" : "Kirim"}</span>
          </button>
        </div>
      ) : null}
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
              className={`${NAV_LINK_CLASS} text-slate-300 hover:text-slate-100`}
              activeProps={{
                className: `${NAV_LINK_CLASS} bg-slate-800 text-cyan-400 font-semibold`,
                "aria-current": "page",
              }}
            >
              <div className="relative">
                <Icon className="h-5 w-5" aria-hidden="true" />
                {badge ? (
                  <span
                    aria-label={`${badge} sesi menunggu sinkronisasi`}
                    className="absolute -right-2.5 -top-1.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold leading-tight text-slate-950"
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
