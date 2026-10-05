import { AlertTriangle, Upload, WifiOff } from 'lucide-react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { useAppStore } from '~/client/state/store/app-store'
import { toast } from '~/client/toast'
import { PURCHASES_STALE_META_KEY } from '~/shared/constants'

/**
 * One status surface for sending. It renders nothing while there is nothing to do, so the
 * shell stays quiet during normal scanning.
 */
export function SyncStatus() {
  const online = useAppStore((state) => state.online)
  const syncing = useAppStore((state) => state.syncing)
  const pendingCount = useAppStore((state) => state.pendingCount)
  const sync = useAppStore((state) => state.sync)
  const stale = useLive(() => localRepo.getMeta(PURCHASES_STALE_META_KEY), [], null)

  const handleSync = async () => {
    const result = await sync()
    toast(result.ok ? 'success' : online ? 'danger' : 'warn', result.message)
  }

  const quiet = pendingCount === 0 && !syncing && stale !== '1'
  if (quiet) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2">
      <div className="flex min-w-0 flex-col">
        {pendingCount > 0 || syncing ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {syncing ? 'Sedang mengirim…' : `${pendingCount} dokumen belum terkirim`}
          </span>
        ) : null}
        {stale === '1' ? (
          <span className="text-sm text-slate-300">Daftar PO mungkin belum diperbarui.</span>
        ) : null}
        {!online && pendingCount > 0 ? (
          <span className="flex items-center gap-1.5 text-sm text-slate-300">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            Offline — dikirim otomatis saat online.
          </span>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Kirim dokumen yang belum terkirim"
        className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-200"
        disabled={!online || syncing}
        onClick={() => void handleSync()}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        <span>{syncing ? 'Mengirim…' : 'Kirim'}</span>
      </button>
    </div>
  )
}
