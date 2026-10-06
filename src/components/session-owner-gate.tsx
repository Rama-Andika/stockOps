import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { Button } from './ui'
import { formatDateTime } from '~/shared/format'

/**
 * What a non-owner sees INSTEAD of the scan cockpit — step 1 of "acknowledge, then look".
 *
 * A whole screen, not a sheet laid over the cockpit: the cockpit focuses the barcode field and
 * installs a window-level scanner wedge as soon as it mounts, so rendering it behind a dialog
 * would let a scan land in a colleague's session while the dialog is still up.
 *
 * It states the RULE, not just the fact. An operator told "this is Budi's" without being told
 * that only Budi can finish it will simply keep pressing.
 */
export function SessionOwnerGate({
  ownerName,
  createdAt,
  onAcknowledge,
}: {
  ownerName: string
  /** Tolerates `null` so a row from an older build cannot blank out this screen. */
  createdAt: string | null
  onAcknowledge: () => void
}) {
  return (
    <div className="flex h-full flex-col justify-center px-3 py-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-owner-gate-title"
        className="rounded-xl border border-warn bg-warn-wash/40 p-4"
      >
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 h-6 w-6 shrink-0 text-warn-text" aria-hidden="true" />
          <div className="min-w-0">
            <h1 id="session-owner-gate-title" className="text-lg font-bold text-fg">
              Sesi ini milik {ownerName}
            </h1>
            <p className="mt-1 text-base text-fg-soft">
              Hanya {ownerName} yang boleh melanjutkan dan menyelesaikannya. Kamu bisa membukanya
              untuk melihat item yang sudah discan, tapi tidak bisa mengubah apa pun.
            </p>
            {createdAt ? (
              <p className="mt-1 text-sm text-fg-subtle">Dibuat {formatDateTime(createdAt)}.</p>
            ) : null}
            {/* The way out, said here because the gate is a dead end otherwise: receiving the
                same PO yourself is allowed and starts from the PO list. */}
            <p className="mt-2 text-sm text-fg-subtle">
              Mau menerima barang sendiri? Buka PO-nya dari daftar PO dan mulai sesi baru.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="secondary" className="w-full" onClick={onAcknowledge}>
            Lihat saja (tidak bisa diubah)
          </Button>
          {/* A Link, not a Button with navigate(): leaving is plain navigation, and the receiving
              list is a static route — the same reason AppBar renders its back control as a Link. */}
          <Link
            to="/sessions"
            className="touch-target flex w-full items-center justify-center rounded-lg bg-brand font-semibold text-on-brand transition hover:bg-brand-bright"
          >
            Kembali ke daftar Penerimaan
          </Link>
        </div>
      </div>
    </div>
  )
}
