import { AlertTriangle, Check, WifiOff } from 'lucide-react'
import { formatRelativeDateTime } from '~/core/format'

/**
 * The one-line answer to "is my work in the system yet". Five forms, and only one of them carries
 * an action, because only one of them can be resolved by pressing something.
 *
 * Rejected documents are NOT one of the forms: a rejection can coexist with pending documents and
 * needs a different decision, so it gets its own callout above this strip. One line would hide
 * whichever came second, and the rejected one is the costlier to miss.
 */
export function SendStatusStrip({
  pendingCount,
  runningCount,
  syncing,
  online,
  lastSyncedAt,
  onSend,
}: {
  /** PENDING + FAILED — what the outbox would push. Does NOT include RUNNING sessions. */
  pendingCount: number
  /**
   * Unfinished sessions. Required, because `pendingCount` cannot see them: without it this strip
   * would state "everything is in the system" while a session full of scans sat on the device,
   * and nothing else on the screen contradicts a green box — SyncStatus goes quiet and the nav
   * badge empties on the same counter.
   */
  runningCount: number
  syncing: boolean
  online: boolean
  /** When the newest document on this device entered the system; null if none ever has. */
  lastSyncedAt: string | null
  onSend: () => void
}) {
  const shell = 'flex items-center justify-between gap-3 rounded-xl border p-3'

  if (syncing) {
    return (
      <div role="status" className={`${shell} border-info bg-info-wash/40`}>
        <p className="min-w-0 text-sm font-semibold text-info-text">Sedang mengirim…</p>
      </div>
    )
  }

  // Nothing queued, but a session is still open: say so instead of claiming everything is in.
  // Scans in a RUNNING session are the easiest work to lose — they have not been finalized, so no
  // other surface counts them.
  if (pendingCount === 0 && runningCount > 0) {
    return (
      <div role="status" className={`${shell} border-warn bg-warn-wash/40`}>
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warn-text" aria-hidden="true" />
          <p className="min-w-0 text-sm text-fg-soft">
            <span className="block font-semibold text-warn-text">
              {runningCount === 1 ? '1 sesi masih berjalan' : `${runningCount} sesi masih berjalan`}
            </span>
            Belum diselesaikan, jadi belum dikirim.
          </p>
        </div>
      </div>
    )
  }

  if (pendingCount === 0) {
    return (
      <div role="status" className={`${shell} border-ok bg-ok-wash/40`}>
        <div className="flex min-w-0 items-center gap-2">
          <Check className="h-5 w-5 shrink-0 text-ok-bright" aria-hidden="true" />
          <p className="min-w-0 text-sm font-semibold text-fg">
            {lastSyncedAt ? 'Semua dokumen sudah masuk sistem' : 'Belum ada dokumen untuk dikirim'}
            {/* Guarded, not passed through: formatRelativeDateTime's own null fallback reads
                "Belum pernah diunduh", which belongs to the PO download that first needed it. */}
            {lastSyncedAt ? (
              <span className="block font-normal text-fg-subtle">
                {formatRelativeDateTime(lastSyncedAt)}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    )
  }

  if (!online) {
    return (
      <div role="status" className={`${shell} border-line bg-raised`}>
        <div className="flex min-w-0 items-center gap-2">
          <WifiOff className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden="true" />
          <p className="min-w-0 text-sm text-fg-soft">
            <span className="block font-semibold text-fg">
              {pendingCount} dokumen belum terkirim
            </span>
            Offline — dikirim otomatis saat perangkat online.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div role="status" className={`${shell} border-warn bg-warn-wash/40`}>
      <p className="min-w-0 text-sm font-semibold text-warn-text">
        {pendingCount} dokumen belum terkirim
      </p>
      <button
        type="button"
        className="touch-target shrink-0 rounded-lg bg-brand px-4 font-semibold text-on-brand transition hover:bg-brand-bright"
        onClick={onSend}
      >
        Kirim
      </button>
    </div>
  )
}
