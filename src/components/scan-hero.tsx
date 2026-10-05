import { AlertTriangle, Check, Info, ScanLine, X } from 'lucide-react'
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
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-700 px-4 py-6 text-center">
        <ScanLine className="h-8 w-8 text-cyan-400" aria-hidden="true" />
        <p className="text-lg font-bold text-slate-100">Siap scan</p>
        <p className="text-sm text-slate-400">
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
        className="rounded-xl border border-emerald-500 bg-emerald-950/40 p-4"
      >
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-300">
          <Check className="h-5 w-5" aria-hidden="true" />
          Ditambahkan
        </p>
        <p className="mt-2 text-xl font-bold text-slate-100">{state.itemName}</p>
        {state.itemCode ? <p className="text-sm text-slate-400">{state.itemCode}</p> : null}
        <p className="mt-2 text-4xl font-black tabular-nums text-slate-100">
          +{formatQty(state.addedQty)} <span className="text-lg font-bold text-slate-400">{state.purchaseUnit}</span>
        </p>
        <p className="mt-1 text-sm tabular-nums text-slate-300">
          = {formatQty(state.stockQty)} {state.stockUnit}
        </p>
        <p className="mt-2 text-sm tabular-nums text-slate-300">
          Item ini: {formatQty(state.itemTotal)} dari {formatQty(state.itemOrdered)} {state.purchaseUnit}
        </p>
        <button
          type="button"
          className="touch-target mt-3 w-full rounded-lg border border-slate-600 font-semibold text-slate-100 transition hover:bg-slate-800"
          onClick={onUndo}
        >
          Batalkan scan ini
        </button>
      </section>
    )
  }

  if (state.kind === 'NOT_FOUND') {
    return (
      <section role="alert" className="rounded-xl border border-red-500 bg-red-950/40 p-4">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-300">
          <X className="h-5 w-5" aria-hidden="true" />
          Tidak dikenal
        </p>
        <p className="mt-2 break-all text-xl font-bold tabular-nums text-slate-100">{state.scannedCode}</p>
        <p className="mt-2 text-sm text-slate-200">
          Barcode ini tidak ada di master barang yang tersimpan di perangkat. Tidak ada yang
          ditambahkan. Laporkan ke admin, atau unduh ulang data master lewat Pengaturan bila perangkat
          sedang online.
        </p>
        <button
          type="button"
          className="touch-target mt-3 w-full rounded-lg bg-slate-700 font-semibold text-slate-100 transition hover:bg-slate-600"
          onClick={onDismiss}
        >
          Mengerti, lanjut scan
        </button>
      </section>
    )
  }

  if (state.kind === 'NOT_IN_PO') {
    return (
      <section role="alert" className="rounded-xl border border-sky-500 bg-sky-950/40 p-4">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sky-300">
          <Info className="h-5 w-5" aria-hidden="true" />
          Bukan item PO ini
        </p>
        <p className="mt-2 text-xl font-bold text-slate-100">{state.itemName}</p>
        <p className="mt-2 text-sm text-slate-200">
          Barangnya dikenal, tapi tidak terdaftar di PO yang sedang dibuka. Tidak ada yang
          ditambahkan. Periksa surat jalan vendor, atau buka PO yang benar dari daftar PO.
        </p>
        <button
          type="button"
          className="touch-target mt-3 w-full rounded-lg bg-slate-700 font-semibold text-slate-100 transition hover:bg-slate-600"
          onClick={onDismiss}
        >
          Mengerti, lanjut scan
        </button>
      </section>
    )
  }

  return (
    <section role="alert" className="rounded-xl border border-amber-400 bg-amber-950/40 p-4">
      <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-300">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        Lebih dari pesanan
      </p>
      <p className="mt-2 text-xl font-bold text-slate-100">{state.itemName}</p>
      <p className="mt-2 text-2xl font-black tabular-nums text-slate-100">
        {formatQty(state.newTotal)} <span className="text-base font-bold text-slate-400">dari</span>{' '}
        {formatQty(state.ordered)} {state.unit}{' '}
        <span className="text-amber-300">+{formatQty(state.excess)}</span>
      </p>
      <p className="mt-2 text-sm text-slate-200">
        Sudah dicatat. Dokumen ini akan menunggu persetujuan admin. Total dihitung dari semua
        perangkat, bukan hanya perangkat ini.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          className="touch-target w-full rounded-lg border border-slate-600 font-semibold text-slate-100 transition hover:bg-slate-800"
          onClick={onUndo}
        >
          Batalkan scan ini
        </button>
        <button
          type="button"
          className="touch-target w-full rounded-lg bg-amber-400 font-semibold text-slate-950 transition hover:bg-amber-300"
          onClick={onDismiss}
        >
          Lanjut scan
        </button>
      </div>
    </section>
  )
}
