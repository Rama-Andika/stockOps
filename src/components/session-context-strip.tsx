import { memo } from 'react'
import { SegmentedProgress } from './segmented-progress'
import { formatQty } from '~/shared/format'

/**
 * Memoised: every keystroke the scanner types re-renders the session screen, and all of this
 * component's props are primitives that do not change while a barcode is being typed.
 */
export const SessionContextStrip = memo(function SessionContextStrip({
  purchaseLabel,
  vendorName,
  itemCount,
  ordered,
  serverReceived,
  localPending,
  overReceive,
  excessTotal,
}: {
  purchaseLabel: string
  vendorName: string
  itemCount: number
  ordered: number
  serverReceived: number
  localPending: number
  overReceive: boolean
  excessTotal: number
}) {
  return (
    <div className="border-b border-slate-700 pb-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-base font-bold tabular-nums text-slate-100">
          {purchaseLabel}
        </p>
        <p className="shrink-0 text-sm text-slate-400">{itemCount} item discan</p>
      </div>
      <p className="truncate text-sm text-slate-400">{vendorName}</p>
      <div className="mt-1">
        <SegmentedProgress
          ordered={ordered}
          serverReceived={serverReceived}
          localPending={localPending}
        />
      </div>
      {overReceive ? (
        <p className="mt-1 text-sm font-semibold text-amber-300">
          Kelebihan terima {formatQty(excessTotal)} — menunggu persetujuan admin.
        </p>
      ) : null}
    </div>
  )
})
