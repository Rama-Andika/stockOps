import { formatQty } from '~/shared/format'

/**
 * Three-segment receiving meter: confirmed by the server, still on this device, and the
 * part above the ordered qty. Percentages are relative to the ordered qty; once the total
 * exceeds it, the bar is normalised so the over-receive part stays visible at the end.
 */
export function SegmentedProgress({
  ordered,
  serverReceived,
  localPending,
  unit,
}: {
  ordered: number
  serverReceived: number
  localPending: number
  unit?: string
}) {
  const total = serverReceived + localPending
  // A PO line with qty 0 would divide by zero; treat the bar as full-scale instead.
  const scale = Math.max(ordered, total, 1)
  const over = Math.max(0, total - ordered)
  const withinOrdered = Math.max(0, total - over)
  // Split what fits inside the ordered qty between server and device, server first.
  const serverPart = Math.min(serverReceived, withinOrdered)
  const pendingPart = Math.max(0, withinOrdered - serverPart)

  const pct = (value: number): string => `${(value / scale) * 100}%`
  const unitSuffix = unit ? ` ${unit}` : ''

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-emerald-500" style={{ width: pct(serverPart) }} />
        <div
          className="h-full bg-emerald-500/40 bg-[repeating-linear-gradient(135deg,#10b981_0_4px,transparent_4px_8px)]"
          style={{ width: pct(pendingPart) }}
        />
        <div className="h-full bg-amber-400" style={{ width: pct(over) }} />
      </div>
      <p className="mt-1 text-sm tabular-nums text-slate-300">
        {formatQty(total)} <span className="text-slate-400">dari</span> {formatQty(ordered)}
        {unitSuffix}
        {localPending > 0 ? (
          <span className="text-slate-400"> · {formatQty(localPending)} belum terkirim</span>
        ) : null}
        {over > 0 ? (
          <span className="font-semibold text-amber-300"> · +{formatQty(over)} lebih</span>
        ) : null}
      </p>
    </div>
  )
}
