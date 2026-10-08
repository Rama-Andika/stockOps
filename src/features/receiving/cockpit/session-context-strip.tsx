import { memo } from 'react'
import { SegmentedProgress } from '~/ui/segmented-progress'

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
}: {
  purchaseLabel: string
  vendorName: string
  itemCount: number
  ordered: number
  serverReceived: number
  localPending: number
}) {
  return (
    <div className="border-b border-line pb-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-base font-bold tabular-nums text-fg">{purchaseLabel}</p>
        <p className="shrink-0 text-sm text-fg-subtle">{itemCount} item discan</p>
      </div>
      <p className="truncate text-sm text-fg-subtle">{vendorName}</p>
      <div className="mt-1">
        <SegmentedProgress
          ordered={ordered}
          serverReceived={serverReceived}
          localPending={localPending}
        />
      </div>
    </div>
  )
})
