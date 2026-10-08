import { AlertTriangle } from 'lucide-react'
import { SegmentedProgress } from '~/ui/segmented-progress'

/**
 * The head of the review screen: which PO, from whom, how much was counted — and, when some item
 * went past what was ordered, a callout that says so BEFORE the operator sends anything.
 *
 * `overItemCount` is passed in rather than read from the session because the session's own
 * `overReceive`/`excessTotal` are written only by `markSynced` (local-repo.ts), i.e. after the
 * server has answered, and this warning is worth showing BEFORE anything is sent. The caller
 * passes `useSessionData`'s `excessByPurchaseItem`, which answers at both moments: the local
 * comparison against the PO before the session is sent, and the server's own per-line figures
 * after it — never the local formula on a sent session, which would count that session's qty
 * twice.
 *
 * The callout states a COUNT of items, never a summed quantity: each item's excess is in that
 * item's own purchase unit, so a single total across items would mix KRT with DUS. The per-item
 * quantity belongs on the recap row, where the unit is known.
 */
export function ReviewSummary({
  purchaseLabel,
  vendorName,
  itemCount,
  qtySummary,
  ordered,
  serverReceived,
  localPending,
  overItemCount,
}: {
  purchaseLabel: string
  vendorName: string
  itemCount: number
  /** Totals per purchase unit, e.g. "40 KRT · 6 DUS". Empty string when nothing is scanned yet. */
  qtySummary: string
  ordered: number
  serverReceived: number
  localPending: number
  overItemCount: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-base font-bold tabular-nums text-fg">
            {purchaseLabel}
          </p>
          <p className="shrink-0 text-sm text-fg-subtle">{itemCount} item</p>
        </div>
        <p className="truncate text-sm text-fg-subtle">{vendorName}</p>
        {qtySummary ? (
          <p className="mt-1 text-sm font-semibold tabular-nums text-fg-soft">{qtySummary}</p>
        ) : null}
        <div className="mt-1">
          <SegmentedProgress
            ordered={ordered}
            serverReceived={serverReceived}
            localPending={localPending}
          />
        </div>
      </div>
      {overItemCount > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warn bg-warn-wash/40 p-3"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn-text" aria-hidden="true" />
          <p className="min-w-0 text-sm text-fg-soft">
            <span className="font-bold text-warn-text">
              {overItemCount} item lebih dari pesanan.
            </span>{' '}
            Tetap dikirim, lalu menunggu persetujuan admin. Jumlah lebihnya tertulis di item yang
            bersangkutan pada rekap di bawah.
          </p>
        </div>
      ) : null}
    </div>
  )
}
