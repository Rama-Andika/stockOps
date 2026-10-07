import { AlertTriangle, Upload, WifiOff } from 'lucide-react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { useAppStore } from '~/client/state/store/app-store'
import { toast } from '~/client/toast'
import { PURCHASES_STALE_META_KEY } from '~/shared/constants'

/**
 * The one definition of "the send surface has nothing to say", plus the three values its text
 * needs.
 *
 * Exported because `UpdateBanner` shares this row in the app bar and has to yield to it — the
 * decision itself lives in `TopBar` (src/components/app-shell.tsx), which owns the layout. The
 * moment there is something to send, the operator needs the count and the "Kirim" button more
 * than a reload offer that will come back by itself 15 minutes later. A second copy of this
 * condition inside the banner would be free to drift away from this one.
 */
export function useSendStatus(): {
  quiet: boolean
  syncing: boolean
  pendingCount: number
  stale: boolean
} {
  const syncing = useAppStore((state) => state.syncing)
  const pendingCount = useAppStore((state) => state.pendingCount)
  const stale = useLive(() => localRepo.getMeta(PURCHASES_STALE_META_KEY), [], null) === '1'
  return { quiet: pendingCount === 0 && !syncing && !stale, syncing, pendingCount, stale }
}

/**
 * One status surface for sending. It renders nothing while there is nothing to do, so the
 * shell stays quiet during normal scanning.
 */
export function SyncStatus() {
  const online = useAppStore((state) => state.online)
  const sync = useAppStore((state) => state.sync)
  const { quiet, syncing, pendingCount, stale } = useSendStatus()

  const handleSync = async () => {
    const result = await sync()
    toast(result.ok ? 'success' : online ? 'danger' : 'warn', result.message)
  }

  if (quiet) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2">
      {/* Text, deliberately not a link. It was briefly a <Link to="/sessions"> on the grounds
          that the cockpit hides BottomNav and this was "the only route" there — which is false:
          the cockpit's own AppBar carries backTo="/sessions" at full size. What the link did add
          was a 20px tap target (text-sm line-height, no padding) and a new focusable element in
          the cockpit chrome whose activation navigates away from the barcode field. It also went
          to /sessions even when the only line it contained was the stale-PO one, which is about
          the PO list. Keep this block inert; the routes to both screens already exist. */}
      <div className="flex min-w-0 flex-col">
        {pendingCount > 0 || syncing ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-warn-text">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {syncing ? 'Sedang mengirim…' : `${pendingCount} dokumen belum terkirim`}
          </span>
        ) : null}
        {stale ? (
          <span className="text-sm text-fg-muted">Daftar PO mungkin belum diperbarui.</span>
        ) : null}
        {!online && pendingCount > 0 ? (
          <span className="flex items-center gap-1.5 text-sm text-fg-muted">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            Offline — dikirim otomatis saat online.
          </span>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Kirim dokumen yang belum terkirim"
        className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand transition hover:bg-brand-bright disabled:cursor-not-allowed disabled:bg-control-off disabled:text-fg-soft"
        disabled={!online || syncing}
        onClick={() => void handleSync()}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        <span>{syncing ? 'Mengirim…' : 'Kirim'}</span>
      </button>
    </div>
  )
}
