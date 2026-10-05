import type { RefObject } from 'react'
import { Plus } from 'lucide-react'
import { NumericPad } from './numeric-pad'
import { inputClass } from './ui'

/** Qty shortcuts for the common cases; anything else goes through the keypad. */
const QTY_CHIPS = [1, 2, 5, 12] as const

/**
 * The pinned bottom bar of the scan cockpit. The barcode field keeps `scanRef` so the focus
 * effect in the session screen can return focus to it after a dialog closes — without that,
 * the scanner's Enter would press whatever button had focus instead.
 */
export function ScanBar({
  scan,
  qty,
  qtyTouched,
  scanRef,
  padOpen,
  onPadOpenChange,
  onScanChange,
  onQtyChange,
  onAdd,
}: {
  scan: string
  qty: string
  qtyTouched: boolean
  scanRef: RefObject<HTMLInputElement | null>
  padOpen: boolean
  onPadOpenChange: (open: boolean) => void
  onScanChange: (value: string) => void
  onQtyChange: (value: string) => void
  onAdd: () => void
}) {

  return (
    <div className="flex flex-col gap-2">
      {padOpen ? (
        // `fixed` on purpose: rendered inline, the keypad would grow the shrink-0 bottom bar and
        // push the qty chips and the tab bar off the bottom of the screen. It covers only the
        // bottom of the screen — a full-screen backdrop would hide the scan result above it,
        // which is the one thing the operator needs to see while scanning.
        <div className="fixed inset-x-0 bottom-0 z-30">
          <div className="border-t border-slate-700 bg-slate-900 p-3 pb-[env(safe-area-inset-bottom)]">
            <p className="mb-2 text-center text-3xl font-black tabular-nums text-slate-100">
              {qty === '' ? '0' : qty}{' '}
              <span className="text-base font-bold text-slate-400">satuan PO</span>
            </p>
            <NumericPad
              value={qtyTouched ? qty : ''}
              onChange={onQtyChange}
              showIncrement={false}
            />
            <button
              type="button"
              className="touch-target mt-2 w-full rounded-lg bg-cyan-500 font-semibold text-slate-900 transition hover:bg-cyan-400"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPadOpenChange(false)}
            >
              Selesai
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <label htmlFor="scan-barcode" className="sr-only">
          Barcode atau kode barang
        </label>
        <input
          id="scan-barcode"
          ref={scanRef}
          className={`${inputClass} flex-1`}
          placeholder="Scan kode…"
          value={scan}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onAdd()
            }
            // Second way out of the keypad sheet: it covers the "123" toggle that opened it, so
            // without this the only exit is the "Selesai" button.
            if (event.key === 'Escape' && padOpen) {
              event.preventDefault()
              onPadOpenChange(false)
            }
          }}
          onChange={(event) => onScanChange(event.target.value)}
        />
        <button
          type="button"
          aria-expanded={padOpen}
          aria-label={padOpen ? 'Tutup keypad angka' : 'Buka keypad angka'}
          className="touch-target w-14 shrink-0 rounded-lg bg-slate-700 font-semibold text-slate-100 transition hover:bg-slate-600"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPadOpenChange(!padOpen)}
        >
          123
        </button>
        <button
          type="button"
          aria-label="Tambah ke sesi"
          className="touch-target w-14 shrink-0 rounded-lg bg-cyan-500 text-slate-900 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-200"
          disabled={!scan.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAdd}
        >
          <Plus className="mx-auto h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="scan-qty" className="sr-only">
          Qty dalam satuan PO
        </label>
        {/* Classes are written out instead of reusing `inputClass`: that string contains `w-full`
            and `px-4`, and Tailwind resolves conflicting utilities by stylesheet order, not by the
            order they appear in className. `w-full` won, the field filled the whole row, and the
            four qty chips were pushed off screen.
            The border colour is a ternary so only one of the two classes is ever present — the same
            conflict cannot come back through this element. No placeholder on purpose: this field is
            only ever empty when the value is INVALID, and a greyed-out "1" there reads as a real
            qty of 1 to the operator, who then cannot see why the scan was rejected. */}
        <input
          id="scan-qty"
          className={`touch-target w-16 shrink-0 rounded-lg border bg-slate-950 px-2 py-3 text-center font-bold tabular-nums text-slate-100 ${
            Number(qty) > 0 ? 'border-slate-600' : 'border-red-500'
          }`}
          inputMode="decimal"
          maxLength={8}
          aria-invalid={!(Number(qty) > 0)}
          value={qty}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            // The scanner types like a keyboard and ends with Enter. Without this, a scan fired
            // while this field has focus would be typed INTO the qty field and silently lost.
            if (event.key === 'Enter') {
              event.preventDefault()
              scanRef.current?.focus()
            }
          }}
          onChange={(event) => {
            const raw = event.target.value
            // Bounded on purpose: at most 5 integer digits and 2 decimals. The unbounded version
            // accepted a whole barcode (pure digits) as a qty.
            if (/^\d{0,5}(?:[.,]\d{0,2})?$/.test(raw)) onQtyChange(raw.replace(',', '.'))
          }}
        />
        {QTY_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            aria-pressed={qty === String(chip)}
            aria-label={`Qty ${chip} satuan PO`}
            className={`touch-target flex-1 rounded-lg px-2 font-semibold transition ${
              qty === String(chip)
                ? 'bg-cyan-500 text-slate-900'
                : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
            }`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onQtyChange(String(chip))}
          >
            ×{chip}
          </button>
        ))}
      </div>
    </div>
  )
}
