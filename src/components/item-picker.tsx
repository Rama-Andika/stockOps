import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { SegmentedProgress } from './segmented-progress'
import { Badge, Button, EmptyState, inputClass } from './ui'
import { formatQty } from '~/shared/format'
import { dec2 } from '~/shared/num'
import {
  filterPickerItems,
  isPickerItemComplete,
  pickerTotalReceived,
  sortPickerItems,
  type PickerItem,
} from '~/shared/item-picker'

/**
 * "Pilih item dari daftar PO" — the way into a session line for goods whose barcode cannot be
 * scanned: no label, a torn label, loose goods.
 *
 * A FULL-SCREEN overlay, rendered BY THE COCKPIT rather than being a route of its own. Both halves
 * of that are load-bearing:
 *
 * - Full screen, because this dialog contains a TEXT FIELD while the cockpit behind it installs a
 *   window-level scanner wedge and an effect that pulls focus into the barcode field. The cockpit
 *   switches both off while this is open (`pickerOpen`), and covering the whole screen is what makes
 *   that switch obviously right instead of merely tidy. `DuplicateSessionSheet` is allowed to be a
 *   bottom sheet because the PO detail screen behind it has neither — its own comment says so.
 * - Rendered by the cockpit, because the result of a pick is announced through `ScanHero`, which is
 *   the cockpit's own state. A separate route would unmount the cockpit and the card would have to
 *   be smuggled back through route state or Dexie.
 *
 * Two steps, ONE overlay: the list, then the qty panel IN ITS PLACE. Not two stacked dialogs —
 * Escape would have two meanings at once, and the focus would have to be restored through two
 * levels on a device whose only pointer is a thumb.
 *
 * Three of the four keypad-first rules that `DuplicateSessionSheet` locks apply here verbatim —
 * a PDT has no pointer, so a dialog the keyboard cannot reach is a dialog nobody can close:
 * `onKeyDown`
 * on the OUTER container, `tabIndex={-1}` so a tap on the chrome parks focus inside the dialog, and
 * an effect that restores the previous `activeElement` on unmount. The fourth — `tabIndex={-1}` on
 * the scrim — has nothing to apply to: this overlay is opaque (`bg-ground`) and has no scrim, so the
 * container IS the panel.
 *
 * Scrolling is allowed here. The "scan loop must fit 360×640 without scrolling" invariant is about
 * the loop an operator repeats one-handed; this is a list of one PO's lines, opened on purpose.
 */
export function ItemPicker({
  purchaseLabel,
  items,
  onPick,
  onClose,
}: {
  /** PO number, or the raw id when the row carries no number. */
  purchaseLabel: string
  items: readonly PickerItem[]
  /** qty is in that line's PO unit, and it is ADDED to whatever the session already holds. */
  onPick: (purchaseItemId: string, qty: number) => void
  onClose: () => void
}) {
  const [term, setTerm] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const visible = useMemo(() => sortPickerItems(filterPickerItems(items, term)), [items, term])
  /**
   * Looked up from `items` on every render instead of being copied into state when the row is
   * tapped: `items` is driven by a live query, so a scan that lands while the qty panel is open
   * keeps the numbers in the panel honest. The qty the operator is typing lives in the panel's own
   * state and is not touched by this.
   */
  const selected = selectedId
    ? (items.find((row) => row.purchaseItemId === selectedId) ?? null)
    : null

  /**
   * Focus the search field on the way in, and hand the focus back on the way out.
   *
   * The cleanup is what makes every exit usable on a keypad: without it, closing the picker drops
   * the focus on `<body>`, where no keystroke reaches anything. `document.contains` is checked
   * because the trigger can be gone by then — the cockpit swaps that very button back to "+" as
   * soon as the barcode field has content again.
   */
  useEffect(() => {
    const previous = document.activeElement
    searchRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus()
    }
  }, [])

  /**
   * The search narrows the list under the highlight. Without this reset, typing one more character
   * can leave `highlight` past the end of the list and Enter then does nothing at all — the kind of
   * dead keystroke that reads as a broken device.
   */
  useEffect(() => {
    setHighlight(0)
  }, [term])

  /**
   * Keep the highlighted row on screen while the operator walks the list with the arrow keys.
   *
   * `typeof … === 'function'` is not defensive programming for its own sake: jsdom does not
   * implement `scrollIntoView`, so without the check every component test that presses ArrowDown
   * would throw a TypeError instead of testing anything.
   */
  useEffect(() => {
    if (selectedId) return
    const row = listRef.current?.children[highlight]
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' })
    }
  }, [highlight, selectedId])

  const openQtyFor = (row: PickerItem) => {
    if (!row.selectable) return
    setSelectedId(row.purchaseItemId)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      // One step at a time: out of the qty panel back to the list, out of the list back to the
      // cockpit. Never both at once — an operator who mistyped a qty would otherwise lose the item
      // they had just found in a thirty-line PO.
      if (selectedId) setSelectedId(null)
      else onClose()
      return
    }

    if (!selectedId && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const count = visible.length
      if (count === 0) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      // Wraps around on purpose: on a keypad, getting from the last row back to the first must not
      // cost twenty-nine presses.
      setHighlight((current) => (current + delta + count) % count)
      return
    }

    if (!selectedId && event.key === 'Enter') {
      // Only when the keystroke came from the search field. A row button handles its own Enter, and
      // acting here as well would open the HIGHLIGHTED item while the operator was pressing Enter on
      // a different, focused one.
      if (event.target !== searchRef.current) return
      event.preventDefault()
      const row = visible[highlight]
      if (row) openQtyFor(row)
      return
    }

    if (event.key !== 'Tab') return
    const panel = rootRef.current
    if (!panel) return
    const list = Array.from(
      panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
    )
    if (list.length === 0) return
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement
    // Focus resting on the container itself — which is where a tap on the heading or the hint text
    // puts it, thanks to `tabIndex={-1}` below — is not in the list, and letting the browser take it
    // from there walks straight out of the dialog. Pull it back in instead.
    if (!(active instanceof HTMLElement) || !list.includes(active)) {
      event.preventDefault()
      if (event.shiftKey) last?.focus()
      else first?.focus()
      return
    }
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    /* `onKeyDown` sits on the OUTER container, not on an inner panel: a React handler only sees
       events that pass through its own node, so one mounted deeper goes deaf the moment the focus is
       anywhere else in the dialog — and Escape is the exit a PDT keypad reaches for first.
       `tabIndex={-1}` makes the container focusable, so a tap on its text parks the focus here
       instead of on `<body>`, where no keystroke would reach this handler at all. */
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Pilih item dari ${purchaseLabel}`}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col bg-ground focus:outline-none"
      onKeyDown={handleKeyDown}
    >
      {selected ? (
        <PickQtyPanel
          // Remounts when the operator backs out and picks a different line, so the qty draft can
          // never be carried over from the previous item.
          key={selected.purchaseItemId}
          row={selected}
          onBack={() => setSelectedId(null)}
          onConfirm={(qty) => onPick(selected.purchaseItemId, qty)}
        />
      ) : (
        <>
          <div className="shrink-0 border-b border-line px-3 py-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="shrink-0 px-3!"
                aria-label="Tutup daftar item PO"
                onClick={onClose}
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </Button>
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-fg">Pilih item · {purchaseLabel}</h2>
                <p className="text-xs text-fg-subtle">
                  Untuk barang tanpa barcode atau label rusak.
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Search className="h-5 w-5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <label htmlFor="item-picker-search" className="sr-only">
                Cari nama, kode, atau barcode
              </label>
              <input
                id="item-picker-search"
                ref={searchRef}
                className={`${inputClass} min-w-0 flex-1 border-line-strong px-2`}
                placeholder="Cari nama / kode / barcode…"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />
            </div>
            <p className="mt-1 text-xs text-fg-subtle">
              Panah atas/bawah memilih, Enter membuka qty, Esc keluar.
            </p>
          </div>

          <ul
            ref={listRef}
            className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto px-3"
          >
            {visible.map((row, index) => (
              <li key={row.purchaseItemId}>
                <button
                  type="button"
                  disabled={!row.selectable}
                  aria-current={index === highlight}
                  /* The highlight is written as a ternary so only ONE `bg-*` class is ever present:
                     Tailwind v4 resolves two classes for the same property by stylesheet order, not
                     by the order in this string. */
                  className={`touch-target w-full py-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                    index === highlight ? 'bg-raised' : 'bg-transparent'
                  }`}
                  onClick={() => openQtyFor(row)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {/* `line-clamp-2` is a height guarantee, not styling: a 40-character ERP item
                          name is ordinary, and at thirty rows an unbounded name turns the list into
                          a scroll marathon. */}
                      <p className="line-clamp-2 font-semibold text-fg">{row.name}</p>
                      <p className="text-sm text-fg-subtle">
                        {row.code ?? '-'} · dipesan {formatQty(row.orderedQty)} {row.unit}
                      </p>
                      <p className="text-sm tabular-nums text-fg-muted">
                        Sudah {formatQty(row.sessionQty)} di sesi ini
                        {row.otherSessionQty > 0
                          ? ` · ${formatQty(row.otherSessionQty)} di sesi lain`
                          : ''}
                        {row.serverReceivedQty > 0
                          ? ` · ${formatQty(row.serverReceivedQty)} di sistem`
                          : ''}
                      </p>
                      {row.selectable ? null : (
                        <p className="text-sm font-semibold text-warn-text">
                          Data barang belum lengkap — unduh ulang data lewat Pengaturan.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {isPickerItemComplete(row) ? <Badge tone="success">Lengkap</Badge> : null}
                      {row.sessionPickedManually ? <Badge tone="neutral">Manual</Badge> : null}
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {visible.length === 0 ? (
              <li>
                {/* Wrapped in <li>: a <p> as a direct child of <ul> is invalid, and a screen reader
                    walking the list role can skip it. */}
                <EmptyState>
                  {term.trim()
                    ? 'Tidak ada item PO yang cocok dengan pencarian itu.'
                    : 'PO ini tidak punya item.'}
                </EmptyState>
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * Step two: how much of the chosen line arrived.
 *
 * It does NOT show the stock-unit conversion ("= 24 PCS"). The conversion factor is resolved at
 * add time from the vendor-item rows (`resolveConvQty`), and the picker deliberately does not load
 * those: one extra query per PO line, on a device where that is measurable, for one line of text.
 * The conversion is shown immediately afterwards, on the `ScanHero` card — which already does.
 * Do not "complete" this panel with it.
 */
function PickQtyPanel({
  row,
  onBack,
  onConfirm,
}: {
  row: PickerItem
  onBack: () => void
  onConfirm: (qty: number) => void
}) {
  /**
   * Default "1", exactly like the qty field in `ScanBar`. Deliberately NOT the outstanding qty: this
   * screen must not offer a number the operator did not count, and a prefilled remainder is accepted
   * by one press of Enter. The outstanding qty is printed above instead, where it informs without
   * being agreed to.
   */
  const [draft, setDraft] = useState('1')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const qty = Number(draft)
  const valid = Number.isFinite(qty) && qty > 0
  const already = pickerTotalReceived(row)
  const newTotal = valid ? dec2(already + qty) : already
  const excess = dec2(newTotal - row.orderedQty)

  const step = (amount: number) => {
    const base = valid ? qty : 1
    const next = dec2(base + amount)
    if (next <= 0) return
    setDraft(String(next))
  }

  const confirm = () => {
    if (valid) onConfirm(qty)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="shrink-0 px-3!"
            aria-label="Kembali ke daftar item"
            onClick={onBack}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
          <h2 className="min-w-0 line-clamp-2 text-base font-bold text-fg">{row.name}</h2>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="text-sm text-fg-subtle">
          {row.code ?? '-'} · dipesan {formatQty(row.orderedQty)} {row.unit}
        </p>
        <p className="mt-1 text-sm tabular-nums text-fg-muted">
          Sudah {formatQty(row.sessionQty)} di sesi ini
          {row.otherSessionQty > 0 ? ` · ${formatQty(row.otherSessionQty)} di sesi lain` : ''}
        </p>
        <div className="mt-2">
          <SegmentedProgress
            ordered={row.orderedQty}
            serverReceived={row.serverReceivedQty}
            localPending={dec2(row.sessionQty + row.otherSessionQty)}
            unit={row.unit}
          />
        </div>

        {/* Said in words, because the number in the field is the only thing that changes on screen:
            this qty is ADDED to what the session already holds, never a replacement. */}
        <p className="mt-3 text-base font-semibold text-fg">Tambah berapa?</p>
        <div className="mt-2 flex items-center gap-3">
          <Button
            variant="secondary"
            className="px-5! py-3! text-xl"
            aria-label="Kurangi qty satu satuan PO"
            onClick={() => step(-1)}
          >
            −1
          </Button>
          <label htmlFor="item-picker-qty" className="sr-only">
            Qty dalam satuan PO
          </label>
          <input
            id="item-picker-qty"
            ref={inputRef}
            className={`${inputClass} w-full border-line-strong text-center text-xl font-bold tabular-nums`}
            inputMode="decimal"
            maxLength={8}
            value={draft}
            onChange={(event) => {
              const raw = event.target.value
              // Same bound as the qty field in `ScanBar`: at most 5 integer digits and 2 decimals,
              // so a whole barcode typed in here cannot become a qty.
              if (/^\d{0,5}(?:[.,]\d{0,2})?$/.test(raw)) setDraft(raw.replace(',', '.'))
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              confirm()
            }}
          />
          <Button
            variant="secondary"
            className="px-5! py-3! text-xl"
            aria-label="Tambah qty satu satuan PO"
            onClick={() => step(1)}
          >
            +1
          </Button>
        </div>

        {/* This total counts other unsent sessions on this device, which the OVER card that appears
            after the write does NOT (`addedHero` uses serverReceived + this line's qty). That is a
            deliberate difference, not a bug on either side: the server aggregates across every
            document and device, so including a colleague's unsent qty is the closer estimate
            — but the scan path's card is long-standing behaviour and is not being changed from here.
            What the difference must not do is read as a retraction, so when the gap exists both
            lines below name where the number came from. */}
        <p className="mt-2 text-sm tabular-nums text-fg-muted">
          Total jadi {formatQty(newTotal)} dari {formatQty(row.orderedQty)} {row.unit}
          {row.otherSessionQty > 0
            ? ` — termasuk ${formatQty(row.otherSessionQty)} dari sesi lain di perangkat ini`
            : ''}
        </p>
        {excess > 0 ? (
          // The same language as the OVER card, because it is the same rule: flagged for admin,
          // never rejected. Warning the operator here, before the write, costs nothing and saves
          // an undo.
          <p className="mt-1 text-sm font-semibold tabular-nums text-warn-text">
            Lebih {formatQty(excess)} {row.unit} dari pesanan. Tetap dicatat dan menunggu persetujuan
            admin.
            {row.otherSessionQty > 0
              ? ' Kelebihan ini dihitung bersama sesi lain di perangkat ini, jadi kartu hasil setelah ini bisa belum menandainya — penandaan resmi dihitung server setelah semua dokumen terkirim.'
              : ''}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <Button className="w-full" disabled={!valid} onClick={confirm}>
          Tambahkan ke sesi
        </Button>
      </div>
    </div>
  )
}
