import { AlertTriangle, Check, Info, ScanLine, X } from 'lucide-react'
import { SegmentedProgress } from '~/ui/segmented-progress'
import { formatQty } from '~/core/format'

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
  | {
      kind: 'NOT_IN_PO'
      itemName: string
      /** The newest other PO on this device that does contain the item, or null if there is none. */
      otherPurchase: { purchaseId: string; number: string | null; vendorName: string } | null
      /** How many FURTHER POs contain it beyond `otherPurchase`. Zero when there are no others. */
      otherCount: number
    }
  | {
      kind: 'OVER'
      itemName: string
      ordered: number
      newTotal: number
      excess: number
      unit: string
    }

/**
 * The biggest element on the scan screen: the result of the last scan. Success is replaced by
 * the next scan; the other states wait for the operator and offer a way out.
 */
export function ScanHero({
  state,
  onUndo,
  onDismiss,
  onOpenPurchase,
  onPickFromPo,
}: {
  state: ScanHeroState
  onUndo: () => void
  onDismiss: () => void
  /** Open another PO. A callback, not a <Link>, on purpose — see the note in F5c-3b. */
  onOpenPurchase: (purchaseId: string) => void
  /**
   * Opens the PO item picker from the NOT_FOUND card, and ONLY from there. Optional, so the whole
   * action disappears when the operator turned the feature off in Pengaturan.
   *
   * Deliberately not offered on NOT_IN_PO. There, the barcode WAS recognised and the answer is
   * definite: the item is not part of this PO. The picker only ever lists this PO's own lines, so
   * the item is guaranteed not to be in it — the action would send the operator looking for
   * something that cannot be there. That card already has the right way out ("Buka PO itu"), and a
   * third button would leave all three about 104px wide at 360px, too narrow for its label.
   */
  onPickFromPo?: () => void
}) {
  if (state.kind === 'IDLE') {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-line px-3 py-3.5 text-center">
        <ScanLine className="h-6 w-6 text-brand-bright" aria-hidden="true" />
        <p className="text-base font-bold text-fg">Siap scan</p>
        <p className="text-xs text-fg-subtle">
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
          +{formatQty(state.addedQty)}{' '}
          <span className="text-base font-bold text-fg-subtle">{state.purchaseUnit}</span>
        </p>
        <p className="text-sm tabular-nums text-fg-muted">
          = {formatQty(state.stockQty)} {state.stockUnit}
        </p>
        <p className="mt-1 text-sm tabular-nums text-fg-muted">
          Item ini: {formatQty(state.itemTotal)} dari {formatQty(state.itemOrdered)}{' '}
          {state.purchaseUnit}
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
          ditambahkan. Laporkan ke admin, atau unduh ulang data master lewat Pengaturan bila
          perangkat sedang online.
        </p>
        {/* Two buttons side by side when the picker is available, one full-width button when it is
            not: the row keeps the same height either way (`touch-target` on both), and this card is
            the tallest of the four, so it has no vertical room to spare. */}
        {onPickFromPo ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="touch-target flex-1 rounded-lg bg-brand px-2 font-semibold text-on-brand transition hover:bg-brand-bright"
              onClick={onPickFromPo}
            >
              Pilih dari PO
            </button>
            <button
              type="button"
              className="touch-target flex-1 rounded-lg bg-control px-2 font-semibold text-fg transition hover:bg-control-off"
              onClick={onDismiss}
            >
              Lanjut scan
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="touch-target mt-3 w-full rounded-lg bg-control font-semibold text-fg transition hover:bg-control-off"
            onClick={onDismiss}
          >
            Mengerti, lanjut scan
          </button>
        )}
      </section>
    )
  }

  if (state.kind === 'NOT_IN_PO') {
    const otherPurchase = state.otherPurchase
    return (
      <section role="alert" className="rounded-xl border border-info bg-info-wash/40 p-4">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-info-text">
          <Info className="h-5 w-5" aria-hidden="true" />
          Bukan item PO ini
        </p>
        {/* `line-clamp-2` is a height guarantee, not styling: the scan loop has to fit 320×640
            without scrolling, and an ERP item name of 40+ characters — ordinary, not an edge
            case — wraps to three lines at text-xl and pushes this card past the scroll area. */}
        <p className="mt-2 line-clamp-2 text-xl font-bold text-fg">{state.itemName}</p>
        {/* Deliberately short: this card is the tallest of the four after NOT_FOUND, and the PO
            identity below has to fit in the same paragraph rather than add a row. */}
        {otherPurchase ? (
          <p className="mt-2 text-sm text-fg-soft">
            Tidak ditambahkan. Barang ini ada di{' '}
            <span className="font-bold text-fg">
              {otherPurchase.number ?? otherPurchase.purchaseId}
            </span>{' '}
            · {otherPurchase.vendorName}
            {state.otherCount > 0 ? ` (+${state.otherCount} PO lain)` : ''}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-fg-soft">
            Tidak ditambahkan. Barang ini tidak ada di PO mana pun yang tersimpan di perangkat.
          </p>
        )}
        {otherPurchase ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="touch-target flex-1 rounded-lg bg-brand px-2 font-semibold text-on-brand transition hover:bg-brand-bright"
              onClick={() => onOpenPurchase(otherPurchase.purchaseId)}
            >
              Buka PO itu
            </button>
            <button
              type="button"
              className="touch-target flex-1 rounded-lg bg-control px-2 font-semibold text-fg transition hover:bg-control-off"
              onClick={onDismiss}
            >
              Lanjut scan
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="touch-target mt-3 w-full rounded-lg bg-control font-semibold text-fg transition hover:bg-control-off"
            onClick={onDismiss}
          >
            Mengerti, lanjut scan
          </button>
        )}
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
