import { AlertTriangle, Check, Info, ScanLine, X } from 'lucide-react'
import { SegmentedProgress } from './segmented-progress'
import { formatQty } from '~/shared/format'

export type ScanHeroState =
  | { kind: 'IDLE' }
  | {
      kind: 'OK'
      itemName: string
      itemCode: string | null
      addedQty: number
      purchaseUnit: string
      stockQty: number
      stockUnit: string
      itemOrdered: number
      itemTotal: number
      /** Part of itemTotal the server already confirmed; the rest is still only on this device. */
      itemServerReceived: number
    }
  | { kind: 'NOT_FOUND'; scannedCode: string }
  | { kind: 'NOT_IN_PO'; itemName: string }
  | { kind: 'OVER'; itemName: string; ordered: number; newTotal: number; excess: number; unit: string }

/**
 * The biggest element on the scan screen: the result of the last scan. Success is replaced by
 * the next scan; the other states wait for the operator and offer a way out.
 */
export function ScanHero({
  state,
  onUndo,
  onDismiss,
}: {
  state: ScanHeroState
  onUndo: () => void
  onDismiss: () => void
}) {
  if (state.kind === 'IDLE') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-6 text-center">
        <ScanLine className="h-8 w-8 text-brand-bright" aria-hidden="true" />
        <p className="text-lg font-bold text-fg">Siap scan</p>
        <p className="text-sm text-fg-subtle">
          Arahkan scanner ke barcode. Hasil terakhir tampil di sini sampai scan berikutnya.
        </p>
      </div>
    )
  }

  if (state.kind === 'OK') {
    return (
      <section
        role="status"
        aria-live="polite"
        className="rounded-xl border border-ok bg-ok-wash/40 p-3"
      >
        {/* The word still leads the screen-reader announcement; on screen the green tick says it. */}
        <span className="sr-only">Ditambahkan</span>
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-ok-bright" aria-hidden="true" />
          <p className="min-w-0 text-lg font-bold leading-tight text-fg">
            {state.itemName}
            {state.itemCode ? (
              <span className="font-normal text-fg-subtle"> · {state.itemCode}</span>
            ) : null}
          </p>
        </div>
        <p className="mt-1 text-3xl font-black tabular-nums text-fg">
          +{formatQty(state.addedQty)} <span className="text-base font-bold text-fg-subtle">{state.purchaseUnit}</span>
        </p>
        <p className="text-sm tabular-nums text-fg-muted">
          = {formatQty(state.stockQty)} {state.stockUnit}
        </p>
        <p className="mt-1 text-sm tabular-nums text-fg-muted">
          Item ini: {formatQty(state.itemTotal)} dari {formatQty(state.itemOrdered)} {state.purchaseUnit}
        </p>
        <div className="mt-1">
          <SegmentedProgress
            compact
            ordered={state.itemOrdered}
            serverReceived={state.itemServerReceived}
            localPending={state.itemTotal - state.itemServerReceived}
          />
        </div>
        <button
          type="button"
          className="touch-target mt-2 w-full rounded-lg border border-line-strong font-semibold text-fg transition hover:bg-raised"
          onClick={onUndo}
        >
          Batalkan scan ini
        </button>
      </section>
    )
  }

  if (state.kind === 'NOT_FOUND') {
    return (
      <section role="alert" className="rounded-xl border border-danger-line bg-danger-wash/40 p-4">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-danger-soft">
          <X className="h-5 w-5" aria-hidden="true" />
          Tidak dikenal
        </p>
        <p className="mt-2 break-all text-xl font-bold tabular-nums text-fg">{state.scannedCode}</p>
        <p className="mt-2 text-sm text-fg-soft">
          Barcode ini tidak ada di master barang yang tersimpan di perangkat. Tidak ada yang
          ditambahkan. Laporkan ke admin, atau unduh ulang data master lewat Pengaturan bila perangkat
          sedang online.
        </p>
        <button
          type="button"
          className="touch-target mt-3 w-full rounded-lg bg-control font-semibold text-fg transition hover:bg-control-off"
          onClick={onDismiss}
        >
          Mengerti, lanjut scan
        </button>
      </section>
    )
  }

  if (state.kind === 'NOT_IN_PO') {
    return (
      <section role="alert" className="rounded-xl border border-info bg-info-wash/40 p-4">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-info-text">
          <Info className="h-5 w-5" aria-hidden="true" />
          Bukan item PO ini
        </p>
        <p className="mt-2 text-xl font-bold text-fg">{state.itemName}</p>
        <p className="mt-2 text-sm text-fg-soft">
          Barangnya dikenal, tapi tidak terdaftar di PO yang sedang dibuka. Tidak ada yang
          ditambahkan. Periksa surat jalan vendor, atau buka PO yang benar dari daftar PO.
        </p>
        <button
          type="button"
          className="touch-target mt-3 w-full rounded-lg bg-control font-semibold text-fg transition hover:bg-control-off"
          onClick={onDismiss}
        >
          Mengerti, lanjut scan
        </button>
      </section>
    )
  }

  return (
    <section role="alert" className="rounded-xl border border-warn bg-warn-wash/40 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn-text" aria-hidden="true" />
        <p className="min-w-0 text-lg font-bold leading-tight text-fg">
          <span className="block text-sm font-bold uppercase tracking-wide text-warn-text">
            Lebih dari pesanan
          </span>
          {state.itemName}
        </p>
      </div>
      <p className="mt-1 text-2xl font-black tabular-nums text-fg">
        {formatQty(state.newTotal)} <span className="text-base font-bold text-fg-subtle">dari</span>{' '}
        {formatQty(state.ordered)} {state.unit}{' '}
        <span className="text-warn-text">+{formatQty(state.excess)}</span>
      </p>
      <p className="mt-1 text-sm leading-snug text-fg-soft">
        Sudah dicatat, menunggu persetujuan admin. Total dihitung dari semua perangkat.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          aria-label="Batalkan scan ini"
          className="touch-target flex-1 rounded-lg border border-line-strong font-semibold text-fg transition hover:bg-raised"
          onClick={onUndo}
        >
          Batalkan
        </button>
        <button
          type="button"
          className="touch-target flex-1 rounded-lg bg-warn font-semibold text-on-warn transition hover:bg-warn-bright"
          onClick={onDismiss}
        >
          Lanjut scan
        </button>
      </div>
    </section>
  )
}
